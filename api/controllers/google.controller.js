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
        console.log(err)
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
      if(!refreshToken){
        return res.status(200).json({ message: "tài khoản chưa được đồng bộ lên google calendar" });
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
          "https://ceaf-117-1-95-251.ngrok-free.app/webhook",

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
          "SELECT google_event_id FROM event WHERE user_id = ?",
          [results[0].id],
          (err, existingEvents) => {
            if (err) {
              return res
                .status(500)
                .json({ error: "Lỗi truy vấn sự kiện từ DB" });
            }

            const existingEventIds = existingEvents.map(
              (event) => event.google_event_id
            ); // Danh sách ID sự kiện trong DB
            const fetchedEventIds = events.map((event) => event.id); // Danh sách ID sự kiện từ Google Calendar API
            // console.log("existingEventIds===========", existingEvents);
            // console.log("fetchedEventIds==============", fetchedEventIds);
            // console.log("Event", events);
            // 🔥 Tìm các sự kiện đã bị xóa trên Google Calendar nhưng vẫn tồn tại trong DB
            const deletedEventIds = existingEventIds.filter(
              (id) => !fetchedEventIds.includes(id)
            );
            const newEventIds = fetchedEventIds.filter(
              (id) => !existingEventIds.includes(id)
            );

            // const updateEventIds = existingEventIds?.filter((id) =>
            //   fetchedEventIds.includes(id)
            // );
            console.log(events);

            if (newEventIds.length > 0) {
              let allEvents = [];

              const eventPromises = events.map((event) => {
                return new Promise((resolve, reject) => {
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
                                    event.start.dateTime
                                  );
                                  let endDate = new Date(event.end.dateTime);

                                  if (frequency === "daily") {
                                    startDate.setDate(startDate.getDate() + i);
                                    endDate.setDate(endDate.getDate() + i);
                                  } else if (frequency === "weekly") {
                                    startDate.setDate(
                                      startDate.getDate() + i * 7
                                    );
                                    endDate.setDate(endDate.getDate() + i * 7);
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
                                etag?.startsWith(event?.etag)
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
                                    start_time: event?.start?.dateTime || new Date(),
                                    end_time: event?.end?.dateTime || new Date(),
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

            // if (updateEventIds.length > 0) {
            //   console.log('them ma vo sua a`')
            //   events.forEach((event) => {
            //     db.query(
            //       "SELECT last_resource_id FROM event WHERE user_id = ?",
            //       [results[0]?.id],
            //       (err, resultEvent) => {
            //         if (err) {
            //           console.error("❌ Lỗi truy vấn DB:", err);
            //           return;
            //         }
            //         // console.log("resultEvent", event?.etag);
            //         const newMap = resultEvent?.map(
            //           (item) => item?.last_resource_id
            //         );
            //         const isExist = newMap.includes(event?.etag);
            //         // const isExist = resultEvent.length > 0;
            //         // const lastEtag = isExist ? resultEvent[0].etag : null;
            //         if (isExist) {
            //           // console.log('zoooo')
            //           console.log(
            //             `🔄 Sự kiện ${resultEvent[0]?.google_event_id} không thay đổi (etag giống nhau), bỏ qua.`
            //           );
            //           return;
            //         }
            //         console.log("zoooo1", event.id);
            //         db.query(
            //           "UPDATE event SET title=?, start_time=?, end_time=?, description=?, last_resource_id=? WHERE google_event_id = ?",
            //           [
            //             event.summary,
            //             event.start.dateTime,
            //             event.end.dateTime,
            //             event.description || "",
            //             `${event.etag}-1`,
            //             event.id,
            //           ],
            //           (err) => {
            //             if (err) console.error("Lỗi lưu sự kiện vào DB:", err);
            //           }
            //         );
            //       }
            //     );
            //   });
            // }
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
