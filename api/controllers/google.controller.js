import { google } from "googleapis";
import dotenv from "dotenv";
import axios from "axios";
import { db } from "./../../index.js";
import { getGoogleUserInfo, getRecurrenceRule } from "../../common/index.js";

dotenv.config();

// Cấu hình OAuth2
export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export const loginGoogle = (req, res) => {
  const userId = req.params.userId;
  // Truy vấn email Google đã liên kết từ database
  db.query(
    "SELECT google_email FROM user WHERE id = ?",
    [userId],
    (err, result) => {
      if (err || !result.length)
        return res.status(500).send("Lỗi truy vấn database");

      const googleEmail = result[0]?.google_email; // Email đã đồng bộ trước đó
      const scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ];
      let authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: googleEmail ? "none" : "consent", // Nếu đã liên kết thì không hiển thị chọn tài khoản
      });

      if (googleEmail) {
        // Chỉ truyền login_hint nếu đã có tài khoản liên kết
        authUrl += `&login_hint=${encodeURIComponent(googleEmail)}`;
      }
      res.redirect(authUrl);
    }
  );
};

export const googleCallback = async (req, res) => {
  const { code, userId } = req.body;

  const data = {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: "authorization_code",
    code: code,
  };

  try {
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      data,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const email = await getGoogleUserInfo(access_token);
    db.query("SELECT * FROM user", [userId], (err, result) => {
      if (err) {
        return res.status(500).json({ message: "Lỗi lấy sự kiện", error: err });
      }
      const findEmail = result?.find((item) => item?.google_email === email);
      if (findEmail) {
        return res
          .status(422)
          .json({ message: "Email đã tồn tại vui lòng thử lại" });
      }
      // Gửi token về cho FE hoặc lưu vào DB
      db.query(
        "UPDATE user SET access_token_google = ?, refresh_token_google = ? WHERE id = ?",
        [access_token, refresh_token, userId],
        (err, result) => {
          if (err) {
            res.status(500).json({ error: err });
            return;
          }
          res.json({ access_token, refresh_token, expires_in });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: "Lỗi khi lấy token" });
  }
};

export const syncCalendar = async (req, res) => {
  const { accessToken, userId } = req.body;
  if (!accessToken) {
    return res
      .status(401)
      .json({ message: "Người dùng chưa đăng nhập Google" });
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
  });
  const email = await getGoogleUserInfo(accessToken);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  db.query("SELECT * FROM user", [userId], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Lỗi lấy sự kiện", error: err });
    }
    const findEmail = result?.find((item) => item?.google_email === email);
    if (findEmail) {
      return res
        .status(422)
        .json({ message: "Email đã tồn tại vui lòng thử lại" });
    }
    // Lấy danh sách sự kiện từ DB

    db.query(
      `SELECT e.* FROM event e
     LEFT JOIN recurring_events r ON e.recurring_id = r.id
     WHERE e.user_id = ? AND e.synced = 0
     AND e.id = (SELECT MIN(e2.id) FROM event e2 WHERE e2.recurring_id = e.recurring_id)`, // Nhóm theo recurring_id để tránh tạo trùng lặp,
      [userId],
      async (err, events) => {
        if (err)
          return res
            .status(500)
            .json({ message: "Lỗi lấy sự kiện", error: err });
        if (events.length === 0) {
          return res
            .status(422)
            .json({ message: "Không có sự kiện mới cần đồng bộ." });
        }
        try {
          for (const event of events) {
            db.query(
              "SELECT * FROM recurring_events WHERE id = ?",
              [event.recurring_id],
              async (err, recurringData) => {
                if (err)
                  return console.error("Lỗi truy vấn recurring_events:", err);
                if (!recurringData.length) return;

                const recurrenceType = recurringData[0]?.frequency; // 'none', 'daily', 'weekly', 'monthly'

                const recurrenceRule = getRecurrenceRule(recurrenceType);
                const googleEvent = {
                  summary: event.title,
                  description: event.description,
                  start: {
                    dateTime: new Date(event.start_time).toISOString(),
                    timeZone: "Asia/Ho_Chi_Minh",
                  },
                  end: {
                    dateTime: new Date(event.end_time).toISOString(),
                    timeZone: "Asia/Ho_Chi_Minh",
                  },
                  recurrence:
                    recurrenceType === "none" ? undefined : [recurrenceRule],
                };
                const response = await calendar.events.insert({
                  calendarId: "primary",
                  resource: googleEvent,
                });
                const googleEventId = response.data.id;
                // 🔹 Nếu không có lặp lại, tạo sự kiện bình thường
                db.query(
                  "SELECT * FROM user WHERE id = ?",
                  [userId],
                  (err, result) => {
                    if (err) {
                      res.status(422).json({ message: "Lỗi đồng bộ" });
                    }
                    if (!result[0]?.google_email) {
                      db.query(
                        "UPDATE user SET google_email = ? WHERE id = ?",
                        [email, userId]
                      );
                    }
                    if (response.status === 200) {
                      db.query(
                        "UPDATE event SET synced = 1, google_event_id = ? WHERE recurring_id = ?",
                        [googleEventId, event.recurring_id]
                      );
                    }
                  }
                );
              }
            );
          }

          res.json({ message: "Đồng bộ lịch thành công!" });
        } catch (error) {
          res.status(500).json({ message: "Lỗi đồng bộ", error });
        }
      }
    );
  });
};

export const checkSyncCalendar = (req, res) => {
  const user_id = req.params.user_id;
  db.query(
    "SELECT * FROM event WHERE user_id = ?  AND synced = 0",
    [user_id],
    (err, result) => {
      if (result?.length === 0) {
        res.status(200).json({ message: "dữ liệu đã được đồng bộ", data: [] });
      }
      if (result.length !== 0) {
        res
          .status(200)
          .json({ message: "dữ liệu chưa được đồng bộ hết", data: result });
      }
      if (err) {
        console.log(err);
        res.status(500).json({ message: "Lỗi không tìm thấy dữ liệu" });
      }
    }
  );
};

export const refreshTokenGoogle = (req, res) => {
  const userId = req.params.userId;
  db.query(
    "SELECT * FROM user WHERE id = ?",
    [userId],
    async (err, results) => {
      if (err || results.length === 0)
        return res.status(400).json({ message: "Không tìm thấy user" });
      const refreshToken = results[0].refresh_token_google;
      if (!refreshToken) {
        return res
          .status(200)
          .json({ message: "tài khoản chưa được đồng bộ lên google calendar" });
      }
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        db.query(
          "UPDATE user SET access_token_google = ? WHERE id = ?",
          [credentials.access_token, userId],
          (err, result) => {
            if (err) {
              res.status(500).json({ error: err });
              return;
            }
            res.json({ accessToken: credentials.access_token });
          }
        );
      } catch (error) {
        res.status(500).json({ message: "Lỗi lấy access token mới", error });
      }
    }
  );
};

export const registerWebhook = async (req, res) => {
  try {
    const { accessToken, email } = req.body;
    oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const webhookId = `webhook-${Date.now()}`; // Sử dụng timestamp để tạo ID duy nhất
    const response = await calendar.events.watch({
      auth: oauth2Client,
      calendarId: "primary", // Dùng "primary" thay vì email
      requestBody: {
        id: webhookId,
        type: "web_hook",
        address:
          "https://8257-2405-4802-1bd6-ac90-39be-3235-2adf-6b6e.ngrok-free.app/webhook",

        token: email,
      },
    });

    res.json({ message: "Webhook registered!", data: response.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const webhookGoogle = async (req, res) => {
  try {
    const userEmail = req.headers["x-goog-channel-token"]; // Kiểm tra nếu bạn đã lưu token theo email

    db.query(
      "SELECT access_token_google, refresh_token_google, id FROM user WHERE email = ?",
      [userEmail],
      async (err, results) => {
        if (err) {
          return res.status(500).json({ error: "Lỗi truy vấn DB" });
        }

        if (!results.length) {
          return res
            .status(400)
            .json({ error: "Không tìm thấy token cho user này" });
        }

        const { access_token_google, refresh_token_google } = results[0];

        // Thiết lập OAuth2 Client với token
        oauth2Client.setCredentials({
          access_token: access_token_google,
          refresh_token: refresh_token_google,
        });

        const calendar = google.calendar({
          version: "v3",
          auth: oauth2Client,
        });

        const response = await calendar.events.list({
          calendarId: "primary",
          maxResults: 2500,
          orderBy: "updated",
          singleEvents: false,
        });

        const events = response.data.items;

        db.query(
          "SELECT google_event_id, last_resource_id FROM event WHERE user_id = ?",
          [results[0].id],
          async (err, existingEvents) => {
            if (err) {
              return res
                .status(500)
                .json({ error: "Lỗi truy vấn sự kiện từ DB" });
            }
            // Danh sách ID sự kiện trong DB
            const existingEventIds = existingEvents.map(
              (event) => event.google_event_id
            );
            const existingEventEtagId = existingEvents.map(
              (event) => event.last_resource_id
            );
            const convertEtagId = existingEventEtagId.map((item) =>
              item ? item?.match(/"(\d+)"/)[0] : ""
            );
            const newConvert = new Set(convertEtagId);

            // Danh sách ID sự kiện trên google
            const fetchedEventIds = events.map((event) => event.id); // Danh sách ID sự kiện từ Google Calendar API

            const fetchedEventEtagId = events
              .map((event) => event?.etag)
              .filter((item) => item.status !== "cancelled");

            const deletedEventIds = existingEventIds.filter(
              (id) => !fetchedEventIds.includes(id)
            );
            const newEventIds = fetchedEventIds.filter(
              (id) => !existingEventIds.includes(id)
            );
            const updateEventEtagId = fetchedEventEtagId?.filter(
              (id) => ![...newConvert].includes(id)
            );
            const filterfetchedEvent = events.filter((item) =>
              updateEventEtagId.includes(item?.etag)
            );
            const findItemUpdateInDatabase = existingEvents.find(
              (item) => item?.google_event_id === filterfetchedEvent[0]?.id
            );
            console.log("event=============", events);
            if (newEventIds.length > 0) {
              let allEvents = [];
              const listEventDelete = [];

              const eventPromises = events.map((event, index) => {
                return new Promise(async (resolve, reject) => {
                  if (event.status === "cancelled") {
                    if (
                      event.recurringEventId &&
                      event.originalStartTime?.dateTime
                    ) {
                      // 1. Xóa event bị hủy trong chuỗi
                      await new Promise((resolve, reject) => {
                        db.query(
                          "DELETE FROM event WHERE google_event_id = ? AND start_time = ?",
                          [
                            event.recurringEventId,
                            event.originalStartTime.dateTime,
                          ],
                          (err, result) => {
                            if (err) return reject(err);
                            resolve();
                          }
                        );
                      });
                      // 2. Lấy danh sách các event còn lại trong chuỗi
                      const result = await new Promise((resolve, reject) => {
                        db.query(
                          "SELECT * FROM event WHERE google_event_id = ?",
                          [event.recurringEventId],
                          (err, result) => {
                            if (err) return reject(err);
                            resolve(result);
                          }
                        );
                      });

                      // 3. Duyệt qua các event còn lại để cập nhật `last_resource_id`
                      if (!listEventDelete.includes(event.etag)) {
                        await Promise.all(
                          result.map(async (item, index) => {
                            // Nếu chưa tồn tại thì mới update
                            await new Promise((resolve, reject) => {
                              db.query(
                                "UPDATE event SET last_resource_id=? WHERE last_resource_id = ?",
                                [
                                  `${event.etag}-${index}`,
                                  item.last_resource_id,
                                ],
                                (err, result) => {
                                  if (err) return reject(err);
                                  resolve();
                                }
                              );
                            });
                          })
                        );
                      }
                    }
                    listEventDelete.push(event.etag);
                  } else {
                    if (newEventIds.includes(event?.id)) {
                      if (event?.recurrence) {
                        // add list event
                        const frequency = event?.recurrence[0]
                          .match(/FREQ=([^;]+)/)[1]
                          .toLowerCase();
                        const count = frequency === "daily" ? 84 : 12;
                        db.query(
                          "INSERT INTO recurring_events (frequency, count) VALUES (?, ?)",
                          [frequency, count],
                          async (err, result) => {
                            if (err)
                              return reject(
                                "Thêm sự kiện thất bại, vui lòng kiểm tra lại"
                              );

                            if (result) {
                              const recurringId = result.insertId;

                              try {
                                const eventInsertPromises = Array.from({
                                  length: count,
                                }).map((_, i) => {
                                  return new Promise((resolve, reject) => {
                                    // Sao chép ngày để tránh bị ghi đè khi thay đổi
                                    let startDate = new Date(
                                      event?.start?.dateTime
                                    );
                                    let endDate = new Date(event.end.dateTime);

                                    if (frequency === "daily") {
                                      startDate.setDate(
                                        startDate.getDate() + i
                                      );
                                      endDate.setDate(endDate.getDate() + i);
                                    } else if (frequency === "weekly") {
                                      startDate.setDate(
                                        startDate.getDate() + i * 7
                                      );
                                      endDate.setDate(
                                        endDate.getDate() + i * 7
                                      );
                                    } else if (frequency === "monthly") {
                                      startDate.setMonth(
                                        startDate.getMonth() + i
                                      );
                                      endDate.setMonth(endDate.getMonth() + i);
                                    }

                                    db.query(
                                      "INSERT INTO event (user_id, last_resource_id, title, start_time, end_time, description, recurring_id, google_event_id, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                      [
                                        results[0]?.id,
                                        `${event.etag}-${i}`,
                                        event.summary,
                                        startDate, // Chuyển thành dạng chuẩn
                                        endDate,
                                        event.description || "",
                                        recurringId,
                                        event?.id,
                                        1,
                                      ],
                                      (err, result) => {
                                        if (err) {
                                          console.error(
                                            "❌ Error inserting event:",
                                            err
                                          );
                                          return reject(err);
                                        }

                                        allEvents.push({
                                          id: result.insertId,
                                          title: event.summary,
                                          start_time: startDate,
                                          end_time: endDate,
                                        });
                                        resolve();
                                      }
                                    );
                                  });
                                });

                                await Promise.all(eventInsertPromises);

                                resolve();
                              } catch (error) {
                                reject(
                                  "Thêm sự kiện thất bại, vui lòng kiểm tra lại"
                                );
                              }
                            }
                          }
                        );
                      } else {
                        // add 1 event
                        db.query(
                          "INSERT INTO recurring_events (frequency, count) VALUES (?, ?)",
                          ["none", 1],
                          (err, result) => {
                            if (err) return reject("Lỗi thêm sự kiện vào DB");

                            const recurringId = result.insertId;

                            db.query(
                              "SELECT last_resource_id FROM event WHERE user_id = ?",
                              [results[0]?.id],
                              (err, resultEvent) => {
                                if (err) return reject("Lỗi truy vấn DB");

                                const newMap = resultEvent?.map(
                                  (item) => item?.last_resource_id
                                );
                                const isExist = newMap.some((etag) =>
                                  etag.startsWith(event?.etag)
                                );

                                if (isExist) {
                                  console.log(
                                    `🔄 Sự kiện ${event?.id} không thay đổi (etag giống nhau), bỏ qua.`
                                  );
                                  return resolve();
                                }

                                db.query(
                                  "INSERT INTO event (user_id, last_resource_id, title, start_time, end_time, description, recurring_id, google_event_id, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                  [
                                    results[0]?.id,
                                    `${event.etag}-1`,
                                    event.summary,
                                    event?.start?.dateTime || new Date(),
                                    event?.end?.dateTime || new Date(),
                                    event.description || "",
                                    recurringId,
                                    event?.id,
                                    1,
                                  ],
                                  (err) => {
                                    if (err)
                                      return reject("Lỗi lưu sự kiện vào DB");
                                    allEvents.push({
                                      id: event?.id,
                                      title: event.summary,
                                      start_time:
                                        event?.start?.dateTime || new Date(),
                                      end_time:
                                        event?.start?.dateTime || new Date(),
                                    });
                                    resolve();
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    } else {
                      resolve();
                    }
                  }
                });
              });

              // Đợi tất cả promises hoàn thành
              Promise.all(eventPromises)
                .then(() => {
                  res.status(200).json({
                    message: "Sự kiện đã được tạo!",
                    data: allEvents,
                  });
                })
                .catch((error) => {
                  res.status(442).json({
                    message: error || "Có lỗi xảy ra khi tạo sự kiện",
                  });
                });
            }

            if (deletedEventIds.length > 0) {
              deletedEventIds.forEach((item) => {
                db.query(
                  "DELETE FROM event WHERE google_event_id  = ? AND user_id = ?",
                  [item, [results[0].id]],
                  (err) => {
                    if (err) {
                      return res
                        .status(500)
                        .json({ error: "Lỗi xóa sự kiện khỏi DB" });
                    }
                  }
                );
              });
            }
            //update
            if (updateEventEtagId.length > 0 && findItemUpdateInDatabase) {
              const itemUpdate = filterfetchedEvent[0];

              const result = await new Promise((resolve, reject) => {
                db.query(
                  "SELECT * FROM event WHERE google_event_id = ?",
                  [itemUpdate.id],
                  (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                  }
                );
              });

              const oldRecurring = await new Promise((resolve, reject) => {
                db.query(
                  "SELECT * FROM recurring_events WHERE id = ?",
                  [result[0]?.recurring_id],
                  (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                  }
                );
              });

              if (itemUpdate?.recurrence || oldRecurring.frequency !== "none") {
                // update list event
                const frequency = itemUpdate?.recurrence
                  ? itemUpdate?.recurrence[0]
                      ?.match(/FREQ=([^;]+)/)[1]
                      ?.toLowerCase()
                  : "none";

                //  Lấy danh sách các event còn lại trong chuỗi
                console.log("frequency==================", frequency);
                if (frequency === oldRecurring[0]?.frequency) {
                  // khong thay doi recurring
                  await Promise.all(
                    result.map(async (item, index) => {
                      await new Promise((resolve, reject) => {
                        db.query(
                          "UPDATE event SET title=?, start_time=?, end_time=?, description=?, last_resource_id=? WHERE last_resource_id = ?",
                          [
                            itemUpdate.summary,
                            itemUpdate.start.dateTime,
                            itemUpdate.end.dateTime,
                            itemUpdate.description,
                            `${itemUpdate.etag}-${index}`,
                            item.last_resource_id,
                          ],
                          (err, result) => {
                            if (err) return reject(err);
                            resolve();
                          }
                        );
                      });
                    })
                  );
                } else {
                  // thay doi recurring
                  const listevents = await new Promise((resolve, reject) => {
                    db.query(
                      "SELECT * FROM event WHERE recurring_id = ? ORDER BY start_time ASC",
                      [oldRecurring[0].id],
                      (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                      }
                    );
                  });
                  const currentEvent = listevents.find(
                    (event) => event.google_event_id === itemUpdate.id
                  );
                  await deleteOldEvents(oldRecurring[0]?.id);
                  await updateRecurringEvent(frequency, oldRecurring[0]?.id);
                  await insertNewEvents(
                    listevents,
                    itemUpdate,
                    frequency,
                    currentEvent.user_id,
                    oldRecurring[0]?.id
                  );
                }
              } else {
                //update 1
                db.query(
                  "UPDATE event SET title=?, start_time=?, end_time=?, description=?, last_resource_id=? WHERE google_event_id = ?",
                  [
                    itemUpdate.summary,
                    itemUpdate.start.dateTime || new Date(),
                    itemUpdate.end.dateTime || new Date(),
                    itemUpdate.description || "",
                    `${itemUpdate.etag}-1`,
                    itemUpdate.id,
                  ],
                  (err) => {
                    if (err) console.error("Lỗi lưu sự kiện vào DB:", err);
                  }
                );
              }
            }
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteOldEvents = (id) => {
  return new Promise((resolve, reject) => {
    db.query("DELETE FROM event WHERE recurring_id = ?", [id], (err) => {
      if (err) return reject(err);
      resolve("Xóa sự kiện thành công!");
    });
  });
};

const insertNewEvents = async (
  listEvent,
  currentEvent,
  frequency,
  userId,
  recurringId
) => {
  let events = [];
  let promises = [];

  if (frequency === "none") {
    db.query(
      "INSERT INTO event (user_id, title, description, start_time, end_time, last_resource_id, recurring_id, synced, google_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        userId,
        currentEvent?.summary,
        currentEvent?.description,
        currentEvent.start.dateTime || new Date(),
        currentEvent.end.dateTime || new Date(),
        `${currentEvent.etag}-1`,
        recurringId,
        1,
        currentEvent?.id,
      ],
      (err, result) => {
        if (err) reject(err);
        else {
          events.push({
            id: result.insertId,
            title: currentEvent?.summary,
            start_time: new Date(currentEvent.start.dateTime),
            end_time: new Date(currentEvent.start.dateTime),
          });

          return Promise.resolve(events);
        }
      }
    );
    return;
  }
  const count = frequency === "daily" ? 84 : 12;
  const oldStart = new Date(listEvent[0].start_time);
  const diffDays = Math.round(
    (oldStart - new Date(currentEvent.start.dateTime)) / (1000 * 60 * 60 * 24)
  );
  const diffWeeks = Math.round(diffDays / 7);
  const diffMonths = Math.round(diffDays / 30); // Giả định mỗi tháng có 30 ngày

  for (let i = 0; i < count; i++) {
    const startDate = new Date(currentEvent.start.dateTime);
    const endDate = new Date(currentEvent.end.dateTime);

    // Tính số ngày chênh lệch so với sự kiện đầu tiên

    // Tạo thời gian mới cho sự kiện hiện tại

    if (frequency === "daily") {
      startDate.setDate(startDate.getDate() + diffDays + i);
      endDate.setDate(endDate.getDate() + diffDays + i);
    } else if (frequency === "weekly") {
      startDate.setDate(startDate.getDate() + (diffWeeks + i) * 7);
      endDate.setDate(endDate.getDate() + (diffWeeks + i) * 7);
    } else if (frequency === "monthly") {
      startDate.setMonth(startDate.getMonth() + diffMonths + i);
      endDate.setMonth(endDate.getMonth() + diffMonths + i);
    }

    const queryPromise = new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO event (user_id, title, description, start_time, end_time, last_resource_id, recurring_id, synced, google_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          currentEvent?.summary,
          currentEvent?.description,
          startDate || new Date(),
          endDate || new Date(),
          `${currentEvent.etag}-${i}`,
          recurringId,
          1,
          currentEvent?.id,
        ],
        (err, result) => {
          if (err) reject(err);
          else {
            events.push({
              id: result.insertId,
              title: currentEvent?.summary,
              start_time: startDate,
              end_time: endDate,
            });
            resolve();
          }
        }
      );
    });

    promises.push(queryPromise);
  }

  return Promise.all(promises).then(() => events);
};

const updateRecurringEvent = (frequency, recurringId) => {
  const count = frequency === "daily" ? 84 : 12;

  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE recurring_events SET frequency = ?, count = ? WHERE id = ?",
      [frequency, count, recurringId],
      (err, result) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};
