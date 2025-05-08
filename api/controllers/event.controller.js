import { db } from "./../../index.js";
import { google } from "googleapis";
import { oauth2Client } from "./google.controller.js";
import { getRecurrenceRule } from "../../common/index.js";

export const addEvent = async (req, res) => {
  const {
    user_id,
    title,
    description,
    frequency,
    start_time,
    end_time,
    accessToken,
    emails,
  } = req.body;

  if (!user_id || !title || !start_time || !end_time) {
    return res.status(400).json({ message: "bạn cần nhập đầy đủ thông tin" });
  }
  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }
  const count = frequency === "daily" ? 84 : 12;
  if (frequency !== "none") {
    db.query(
      "INSERT INTO recurring_events (frequency, count) VALUES (?, ?)",
      [frequency, count],
      async (err, result) => {
        if (err) {
          return res.status(442).json({
            message: "Thêm sự kiện thất bại, vui lòng kiểm tra lại",
          });
        }

        const recurringId = result.insertId;
        let events = [];

        try {
          await Promise.all(
            Array.from({ length: count }).map((_, i) => {
              return new Promise((resolve, reject) => {
                let startDate = new Date(start_time);
                let endDate = new Date(end_time);

                if (frequency === "daily") {
                  startDate.setDate(startDate.getDate() + i);
                  endDate.setDate(endDate.getDate() + i);
                } else if (frequency === "weekly") {
                  startDate.setDate(startDate.getDate() + i * 7);
                  endDate.setDate(endDate.getDate() + i * 7);
                } else if (frequency === "monthly") {
                  startDate.setMonth(startDate.getMonth() + i);
                  endDate.setMonth(endDate.getMonth() + i);
                }

                db.query(
                  "INSERT INTO event (user_id, title, description, start_time, end_time, recurring_id) VALUES (?, ?, ?, ?, ?, ?)",
                  [
                    user_id,
                    title,
                    description,
                    startDate,
                    endDate,
                    recurringId,
                  ],
                  (err, result) => {
                    if (err) return reject(err);
                    const insertedId = result.insertId;

                    if (emails.length > 0 && accessToken) {
                      const values = emails.map((email) => [
                        insertedId,
                        email,
                        "needsAction",
                      ]);
                      db.query(
                        "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                        [values],
                        (err) => {
                          if (err) return reject(err);
                          events.push({
                            id: insertedId,
                            title,
                            start_time: startDate,
                            end_time: endDate,
                          });
                          resolve();
                        }
                      );
                    } else {
                      events.push({
                        id: insertedId,
                        title,
                        start_time: startDate,
                        end_time: endDate,
                      });
                      resolve();
                    }
                  }
                );
              });
            })
          );

          if (accessToken) {
            const { googleEventId, etag } = await insertCalendarToGoogle(
              frequency,
              { title, description, start_time, end_time, recurringId },
              emails
            );

            const result = await new Promise((resolve, reject) => {
              db.query(
                "SELECT * FROM event WHERE recurring_id = ?",
                [recurringId],
                (err, result) => {
                  if (err) return reject(err);
                  resolve(result);
                }
              );
            });

            result.map(async (item, index) => {
              await new Promise((resolve, reject) => {
                db.query(
                  "UPDATE event SET google_event_id = ?, synced = ?, last_resource_id = ? WHERE id = ?",
                  [googleEventId, 1, `${etag}-${index}`, item.id],
                  (err) => (err ? reject(err) : resolve())
                );
              });
            });
          }

          return res.status(200).json({
            message: "Chuỗi sự kiện đã được tạo!",
            data: events,
          });
        } catch (error) {
          return res.status(500).json({
            message: "Lỗi hệ thống khi tạo sự kiện",
            error: error.message,
          });
        }
      }
    );
    return;
  }
  // add 1
  db.query(
    "INSERT INTO recurring_events (frequency, count) VALUES (?, ?)",
    [frequency, count],
    (err, result) => {
      if (err) {
        return res.status(442).json({
          message: "Thêm sự kiện thất bại, vui lòng kiểm tra lại",
        });
      }
      if (result) {
        const recurringId = result.insertId;
        db.query(
          "INSERT INTO event (user_id, title, description, start_time, end_time, recurring_id) VALUES (?, ?, ?, ?, ?, ?)",
          [user_id, title, description, start_time, end_time, recurringId],
          async (err, result) => {
            if (err) {
              res.status(442).json({
                message: "Thêm sự kiện thất bại vui lòng kiểm tra lại",
              });
            }
            const insertedId = result.insertId;
            if (accessToken) {
              const calendar = google.calendar({
                version: "v3",
                auth: oauth2Client,
              });
              const recurrenceRule = getRecurrenceRule(frequency);

              const googleEvent = {
                summary: title,
                description: description,
                start: {
                  dateTime: new Date(start_time).toISOString(),
                  timeZone: "Asia/Ho_Chi_Minh",
                },
                end: {
                  dateTime: new Date(end_time).toISOString(),
                  timeZone: "Asia/Ho_Chi_Minh",
                },
                recurrence: frequency === "none" ? undefined : [recurrenceRule],
                attendees: emails.map((email) => ({
                  email,
                })),
              };
              const response = await calendar.events.insert({
                calendarId: "primary",
                resource: googleEvent,
                sendUpdates: "all", // gửi thông báo mời tới attendees
              });

              const googleEventId = response.data.id;
              if (response?.status === 200) {
                db.query(
                  "UPDATE event SET  google_event_id = ?, synced = ? WHERE id=?",
                  [googleEventId, 1, insertedId],
                  (err, result) => {
                    if (err) {
                      return res.status(442).json({
                        message: "đông bộ lên google calendar không thành công",
                      });
                    }

                    if (emails.length > 0) {
                      const values = emails.map((email) => [
                        insertedId,
                        email,
                        "needsAction",
                      ]);

                      db.query(
                        "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                        [values],
                        (err) => {
                          if (err) {
                            return res.status(500).json({
                              message: "Lỗi lưu danh sách người tham gia",
                              error: err,
                            });
                          }
                          return res.status(200).json({
                            message: "Sự kiện đã được tạo",
                          });
                        }
                      );
                    } else {
                      return res.status(200).json({
                        message: "Sự kiện đã được tạo",
                      });
                    }
                  }
                );
              }
            } else {
              res.status(200).json({
                message: "Sự kiện đã được tạo",
              });
            }
          }
        );
      }
    }
  );
};

export const respondToEvent = (req, res) => {
  const { event_id, email, response_status, accessToken } = req.body;
  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }
  if (!event_id || !email || !response_status || !accessToken) {
    return res
      .status(400)
      .json({ message: "Thiếu dữ liệu phản hồi hoặc accessToken" });
  }

  const validStatuses = ["accepted", "declined", "tentative"];
  if (!validStatuses.includes(response_status)) {
    return res.status(400).json({ message: "Trạng thái không hợp lệ" });
  }

  // Bắt đầu cập nhật vào database
  const query = `
    UPDATE event_attendees
    SET response_status = ?
    WHERE event_id = ? AND email = ?
  `;

  db.query(query, [response_status, event_id, email], (err, result) => {
    if (err) {
      console.error("Lỗi cập nhật phản hồi:", err);
      return res.status(500).json({ message: "Lỗi server" });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy người được mời trong sự kiện" });
    }

    // Sau khi cập nhật DB, tiến hành đồng bộ lên Google Calendar
    db.query(
      "SELECT google_event_id FROM event WHERE id = ?",
      [event_id],
      async (err, eventResult) => {
        if (err || !eventResult.length || !eventResult[0].google_event_id) {
          return res.status(200).json({
            message: "Phản hồi thành công (không đồng bộ được Google Calendar)",
          });
        }

        const google_event_id = eventResult[0].google_event_id;

        // Lấy danh sách tất cả attendee để cập nhật lại toàn bộ attendees
        db.query(
          "SELECT email, response_status FROM event_attendees WHERE event_id = ?",
          [event_id],
          async (err, attendees) => {
            if (err) {
              console.error("Lỗi lấy attendees:", err);
              return res
                .status(500)
                .json({ message: "Lỗi lấy danh sách người tham gia" });
            }

            // Đồng bộ lên Google Calendar
            try {
              const calendar = google.calendar({
                version: "v3",
                auth: oauth2Client,
              });

              const response = await calendar.events.patch({
                calendarId: "primary",
                eventId: google_event_id,
                resource: {
                  attendees: attendees.map((att) => ({
                    email: att.email,
                    responseStatus: att.response_status,
                  })),
                },
                sendUpdates: "all",
              });

              if (response.status === 200) {
                return res.status(200).json({
                  message: "Phản hồi thành công và đã đồng bộ Google Calendar",
                });
              } else {
                return res.status(200).json({
                  message:
                    "Phản hồi thành công (Google Calendar không phản hồi OK)",
                });
              }
            } catch (err) {
              console.error("Lỗi đồng bộ Google Calendar:", err.message);
              return res.status(200).json({
                message:
                  "Phản hồi thành công (lỗi khi đồng bộ Google Calendar)",
              });
            }
          }
        );
      }
    );
  });
};

export const respondToEventRecurring = (req, res) => {
  const { event_id, email, response_status, accessToken } = req.body;

  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }

  if (!event_id || !email || !response_status || !accessToken) {
    return res
      .status(400)
      .json({ message: "Thiếu dữ liệu phản hồi hoặc accessToken" });
  }

  const validStatuses = ["accepted", "declined", "tentative"];
  if (!validStatuses.includes(response_status)) {
    return res.status(400).json({ message: "Trạng thái không hợp lệ" });
  }

  // Truy vấn để lấy recurring_id và google_event_id
  const eventInfoQuery = `SELECT recurring_id, google_event_id FROM event WHERE id = ?`;

  db.query(eventInfoQuery, [event_id], (err, eventResult) => {
    if (err || !eventResult.length) {
      return res
        .status(500)
        .json({ message: "Không tìm thấy sự kiện", error: err });
    }

    const { recurring_id, google_event_id } = eventResult[0];

    // Lấy danh sách tất cả các sự kiện thuộc cùng recurring_id
    const getEventsQuery = recurring_id
      ? "SELECT id FROM event WHERE recurring_id = ?"
      : "SELECT id FROM event WHERE id = ?";

    const param = recurring_id ? [recurring_id] : [event_id];

    db.query(getEventsQuery, param, async (err, allEvents) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Lỗi truy vấn danh sách sự kiện", error: err });
      }

      const eventIds = allEvents.map((e) => e.id);

      // Cập nhật trạng thái trong bảng event_attendees
      const updateQuery = `
        UPDATE event_attendees
        SET response_status = ?
        WHERE email = ? AND event_id IN (?)
      `;

      db.query(
        updateQuery,
        [response_status, email, eventIds],
        async (err, result) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Lỗi cập nhật phản hồi", error: err });
          }

          // Lấy danh sách attendees để đồng bộ lên Google Calendar (chỉ cần cho 1 event đại diện)
          const attendeesQuery = `SELECT email, response_status FROM event_attendees WHERE event_id = ?`;
          db.query(attendeesQuery, [event_id], async (err, attendees) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Lỗi khi lấy attendees", error: err });
            }

            try {
              const calendar = google.calendar({
                version: "v3",
                auth: oauth2Client,
              });

              const response = await calendar.events.patch({
                calendarId: "primary",
                eventId: google_event_id,
                resource: {
                  attendees: attendees.map((att) => ({
                    email: att.email,
                    responseStatus: att.response_status,
                  })),
                },
                sendUpdates: "all",
              });

              return res.status(200).json({
                message:
                  response.status === 200
                    ? "Phản hồi thành công và đã đồng bộ Google Calendar"
                    : "Phản hồi thành công (Google không phản hồi OK)",
              });
            } catch (err) {
              console.error("Lỗi đồng bộ Google Calendar:", err.message);
              return res.status(200).json({
                message:
                  "Phản hồi thành công (lỗi khi đồng bộ Google Calendar)",
              });
            }
          });
        }
      );
    });
  });
};

export const listEventByUser = (req, res) => {
  const user_id = Number(req.params.user_id);

  // Lấy google_email của người dùng hiện tại
  db.query(
    "SELECT google_email FROM user WHERE id = ?",
    [user_id],
    (err, userResult) => {
      if (err || userResult.length === 0) {
        return res
          .status(500)
          .json({ message: "Không tìm thấy người dùng", error: err });
      }

      const google_email = userResult[0].google_email;

      // Truy vấn sự kiện của người dùng hoặc được chia sẻ
      const query = `
        SELECT 
          e.id AS event_id,
          e.user_id AS owner_id,
          e.title,
          e.description,
          e.start_time,
          e.end_time,
          e.status,
          e.meet_link,
          e.recurring_id,
          ea.email AS attendee_email,
          ea.response_status
        FROM event e
        LEFT JOIN event_attendees ea ON e.id = ea.event_id
        WHERE e.user_id = ? OR ea.email = ?
      `;

      db.query(query, [user_id, google_email], (err, results) => {
        if (err) {
          return res.status(500).json({ message: "Lỗi server!", error: err });
        }

        const eventMap = new Map();
        results.forEach((row) => {
          if (!eventMap.has(row.event_id)) {
            // Tạo sự kiện mới nếu chưa tồn tại
            eventMap.set(row.event_id, {
              id: row.event_id,
              title: row.title,
              status: row.status,
              description: row.description,
              start_time: row.start_time,
              end_time: row.end_time,
              recurring_id: row.recurring_id,
              can_edit: row.owner_id === user_id,
              meet_link: row.meet_link,
              attendees: row.attendee_email
                ? [
                    {
                      email: row.attendee_email,
                      response_status: row.response_status,
                    },
                  ]
                : [],
            });
          } else {
            // Nếu sự kiện đã tồn tại, chỉ thêm attendee nếu có
            if (row.attendee_email) {
              const event = eventMap.get(row.event_id);
              event.attendees.push({
                email: row.attendee_email,
                response_status: row.response_status,
              });
            }
          }
        });

        const data = Array.from(eventMap.values());
        res.status(200).json({
          message: "Thành công",
          data,
        });
      });
    }
  );
};

export const updateEvent = (req, res) => {
  const { id, title, description, start_time, end_time, accessToken, emails } =
    req.body;

  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }

  db.query("SELECT * FROM event WHERE id = ?", [id], async (err, result) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Lỗi truy vấn database", error: err });
    }

    if (!result.length) {
      return res.status(404).json({ message: "Không tìm thấy sự kiện" });
    }

    const googleEventId = result[0]?.google_event_id;

    // Nếu không có Google Event, chỉ cập nhật trong database
    if (!googleEventId) {
      return db.query(
        "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?",
        [title, description, start_time, end_time, id],
        (err) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Cập nhật database thất bại", error: err });
          }
          return res
            .status(200)
            .json({ message: "Cập nhật thành công trong database!" });
        }
      );
    }

    try {
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });

      const instances = await calendar.events.instances({
        calendarId: "primary",
        eventId: googleEventId,
      });

      if (!instances.data.items || instances.data.items.length === 0) {
        return res
          .status(404)
          .json({ message: "Không tìm thấy instance của sự kiện" });
      }

      const instanceToUpdate = instances.data.items.find((event) => {
        const eventStart = new Date(event.start.dateTime).getTime();
        const dbStart = new Date(result[0]?.start_time).getTime();
        return eventStart === dbStart;
      });

      if (!instanceToUpdate && !result[0]?.instance_id) {
        return res
          .status(404)
          .json({ message: "Không tìm thấy instance phù hợp để cập nhật" });
      }

      const response = await calendar.events.patch({
        calendarId: "primary",
        eventId: instanceToUpdate?.id || result[0]?.instance_id,
        resource: {
          summary: title,
          description: description,
          start: {
            dateTime: new Date(start_time).toISOString(),
            timeZone: "Asia/Ho_Chi_Minh",
          },
          end: {
            dateTime: new Date(end_time).toISOString(),
            timeZone: "Asia/Ho_Chi_Minh",
          },
          attendees: emails.map((email) => ({
            email,
            responseStatus: "needsAction",
          })),
        },
        sendUpdates: "all",
      });

      if (response.status === 200) {
        db.query(
          "DELETE FROM event_attendees WHERE event_id = ?",
          [id],
          (err) => {
            if (err) {
              return res.status(500).json({
                message: "Lỗi khi xoá attendees cũ trong database",
                error: err,
              });
            }

            const updateQuery =
              googleEventId === response.data.id
                ? "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?"
                : "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ?, instance_id = ? WHERE id = ?";

            const updateValues =
              googleEventId === response.data.id
                ? [title, description, start_time, end_time, id]
                : [
                    title,
                    description,
                    start_time,
                    end_time,
                    response.data.id,
                    id,
                  ];

            db.query(updateQuery, updateValues, (err) => {
              if (err) {
                return res.status(500).json({
                  message: "Cập nhật database thất bại",
                  error: err,
                });
              }

              if (emails.length > 0) {
                const values = emails.map((email) => [
                  id,
                  email,
                  "needsAction",
                ]);
                db.query(
                  "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                  [values],
                  (err) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Lỗi lưu danh sách người tham gia",
                        error: err,
                      });
                    }
                    return res.status(200).json({
                      message: "Cập nhật thành công trên Google và database!",
                    });
                  }
                );
              } else {
                return res.status(200).json({
                  message: "Cập nhật thành công trên Google và database!",
                });
              }
            });
          }
        );
      } else {
        return res
          .status(500)
          .json({ message: "Lỗi cập nhật Google Calendar" });
      }
    } catch (error) {
      return res.status(500).json({
        message: "Lỗi khi gọi Google API",
        error: error.message,
      });
    }
  });
};

export const deleteEvent = (req, res) => {
  const eventId = req.params.id;
  const accessToken = req.params.accessToken;
  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }
  db.query(
    "SELECT * FROM event WHERE id = ?",
    [eventId],
    async (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Lỗi truy vấn trong database", error: err });
      if (results.length === 0)
        return res.status(404).json({ message: "Không tìm thấy sự kiện" });

      const googleEventId = results[0].google_event_id;

      if (googleEventId) {
        try {
          const calendar = google.calendar({
            version: "v3",
            auth: oauth2Client,
          });
          const startTime = new Date(results[0].start_time).toISOString();
          const instances = await calendar.events.instances({
            calendarId: "primary",
            eventId: googleEventId,
          });
          const instanceToDelete = instances.data.items.find((event) => {
            const eventStart = new Date(event.start.dateTime).getTime();
            const dbStart = new Date(startTime).getTime();

            return eventStart === dbStart;
          });

          if (!instanceToDelete) {
            return res
              .status(404)
              .json({ message: "Không tìm thấy instance cần xoá" });
          }
          await calendar.events.delete({
            calendarId: "primary",
            eventId: instanceToDelete.id,
          });
        } catch (error) {
          return res
            .status(500)
            .json({ message: "Lỗi đồng bộ với Google Calendar", error });
        }
      }

      // Xóa sự kiện khỏi database
      db.query("DELETE FROM event WHERE id = ?", [eventId], (err) => {
        if (err)
          return res
            .status(500)
            .json({ message: "Lỗi xóa sự kiện", error: err });
        res.status(200).json({ message: "Xóa sự kiện thành công!" });
      });
    }
  );
};

export const getDetailRecurringEvent = (req, res) => {
  const id = req.params.id;

  // Truy vấn thông tin sự kiện theo ID
  db.query("SELECT * FROM event WHERE id = ?", [id], (err, eventResult) => {
    if (err) {
      return res.status(500).json({ message: "Lỗi truy vấn database (event)" });
    }

    if (!eventResult.length) {
      return res.status(404).json({ message: "Không tìm thấy sự kiện" });
    }

    const event = eventResult[0];

    // Truy vấn thông tin recurring_event
    db.query(
      "SELECT * FROM recurring_events WHERE id = ?",
      [event.recurring_id],
      (err, recurringResult) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Lỗi truy vấn database (recurring_event)" });
        }

        if (!recurringResult.length) {
          return res
            .status(404)
            .json({ message: "Không tìm thấy sự kiện lặp" });
        }

        const recurringEvent = recurringResult[0];

        // Truy vấn danh sách người được chia sẻ sự kiện
        db.query(
          "SELECT email FROM event_attendees WHERE event_id = ?",
          [id],
          (err, attendees) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Lỗi truy vấn database (attendees)" });
            }
            const shareEmails = attendees.map((a) => a.email);

            return res.status(200).json({
              message: "Lấy sự kiện lặp thành công",
              data: {
                ...recurringEvent,
                share_email: shareEmails,
              },
            });
          }
        );
      }
    );
  });
};

export const deleteRecurringEvent = (req, res) => {
  const eventId = req.params.id;
  const accessToken = req.params.accessToken;

  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }

  db.query("SELECT * FROM event WHERE id = ?", [eventId], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Lỗi truy vấn database" });
    }
    if (!result || result.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy sự kiện cần xoá" });
    }

    db.beginTransaction((err) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Lỗi khi bắt đầu transaction", error: err });
      }

      db.query(
        "DELETE FROM event WHERE recurring_id = ?",
        [result[0]?.recurring_id],
        (err) => {
          if (err) {
            return db.rollback(() => {
              return res
                .status(500)
                .json({ message: "Lỗi khi xoá sự kiện con", error: err });
            });
          }

          db.query(
            "DELETE FROM recurring_events WHERE id = ?",
            [result[0]?.recurring_id],
            async (err) => {
              if (err) {
                return db.rollback(() => {
                  return res
                    .status(500)
                    .json({ message: "Lỗi khi xoá sự kiện lặp", error: err });
                });
              }

              const googleEventId = result[0].google_event_id;

              if (googleEventId) {
                try {
                  const calendar = google.calendar({
                    version: "v3",
                    auth: oauth2Client,
                  });
                  await calendar.events.delete({
                    calendarId: "primary",
                    eventId: googleEventId,
                  });
                } catch (error) {
                  return res.status(500).json({
                    message: "Lỗi đồng bộ với Google Calendar",
                    error,
                  });
                }
              }

              // Đảm bảo transaction được commit dù có googleEventId hay không
              db.commit((err) => {
                if (err) {
                  return db.rollback(() => {
                    return res.status(500).json({
                      message: "Lỗi khi commit transaction",
                      error: err,
                    });
                  });
                }
                res
                  .status(200)
                  .json({ message: "Đã xoá thành công chuỗi sự kiện" });
              });
            }
          );
        }
      );
    });
  });
};

const insertCalendarToGoogle = async (type, event, emails = []) => {
  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client,
  });
  const recurrenceRule = getRecurrenceRule(type);

  const googleEvent = {
    summary: event?.title,
    description: event?.description,
    start: {
      dateTime: new Date(event?.start_time).toISOString(),
      timeZone: "Asia/Ho_Chi_Minh",
    },
    end: {
      dateTime: new Date(event?.end_time).toISOString(),
      timeZone: "Asia/Ho_Chi_Minh",
    },
    recurrence: type === "none" ? undefined : [recurrenceRule],
    attendees: emails.map((email) => ({ email })),
  };
  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: googleEvent,
    sendUpdates: "all",
  });
  return { googleEventId: response.data.id, etag: response.data.etag };
};

export const updateRecurringEvent = (req, res) => {
  const recurringId = req.params.id;
  const {
    user_id,
    frequency,
    title,
    description,
    start_time,
    end_time,
    id,
    accessToken,
    emails,
  } = req.body;

  if (accessToken) {
    oauth2Client.setCredentials({
      access_token: accessToken,
    });
  }

  const count = frequency === "daily" ? 90 : 12; // Daily: 90 ngày, Weekly/Monthly: 12 lần

  db.beginTransaction((err) => {
    if (err)
      return res.status(500).json({ message: "Lỗi transaction", error: err });

    db.query(
      "SELECT frequency FROM recurring_events WHERE id = ?",
      [recurringId],
      (err, results) => {
        if (err || results.length === 0) {
          return db.rollback(() => {
            res
              .status(500)
              .json({ message: "Không tìm thấy sự kiện lặp", error: err });
          });
        }

        const oldFrequency = results[0].frequency;

        // Nếu cần xóa sự kiện cũ trước khi cập nhật
        const deleteOldEmailAttendees = () => {
          return new Promise((resolve, reject) => {
            db.query(
              "DELETE FROM event_attendees WHERE event_id = ?",
              [id],
              (err) => {
                if (err) return reject(err);
                resolve("Xóa sự kiện thành công!");
              }
            );
          });
        };

        const deleteOldEvents = () => {
          return new Promise((resolve, reject) => {
            db.query(
              "SELECT * FROM event WHERE id = ?",
              [id],
              async (err, result) => {
                if (err) return reject(err);

                if (!result.length)
                  return reject(new Error("Không tìm thấy sự kiện"));

                const googleEventId = result[0]?.google_event_id;
                try {
                  const calendar = google.calendar({
                    version: "v3",
                    auth: oauth2Client,
                  });

                  // Xóa sự kiện trên Google Calendar
                  const response = await calendar.events.delete({
                    calendarId: "primary",
                    eventId: googleEventId,
                  });
                  if (response?.status === 204) {
                    db.query(
                      "DELETE FROM event WHERE recurring_id = ?",
                      [recurringId],
                      (err) => {
                        if (err) return reject(err);
                        resolve("Xóa sự kiện thành công!");
                      }
                    );
                  } else {
                    reject(
                      new Error("Không thể xóa sự kiện trên Google Calendar")
                    );
                  }
                } catch (error) {
                  reject(error); // BẮT LỖI ĐÚNG CÁCH
                }
              }
            );
          });
        };

        const updateRecurringEvent = () => {
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

        const insertNewEvents = async (listEvent, currentEvent) => {
          let events = [];
          let promises = [];

          if (frequency === "none") {
            db.query(
              "INSERT INTO event (user_id, title, description, start_time, end_time, recurring_id) VALUES (?, ?, ?, ?, ?, ?)",
              [
                user_id,
                title,
                description,
                new Date(start_time),
                new Date(end_time),
                recurringId,
              ],
              (err, result) => {
                if (err) reject(err);
                else {
                  if (emails.length > 0 && accessToken) {
                    const values = emails.map((email) => [
                      result.insertId,
                      email,
                      "needsAction",
                    ]);

                    db.query(
                      "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                      [values],
                      (err) => {
                        if (err) {
                          reject(err);
                        }
                        events.push({
                          id: result.insertId,
                          title,
                          start_time: new Date(start_time),
                          end_time: new Date(end_time),
                        });

                        return Promise.resolve(events);
                      }
                    );
                  } else {
                    events.push({
                      id: result.insertId,
                      title,
                      start_time: new Date(start_time),
                      end_time: new Date(end_time),
                    });

                    return Promise.resolve(events);
                  }
                }
              }
            );
            return;
          }
          const oldStart = new Date(listEvent[0].start_time);
          const diffDays = Math.round(
            (oldStart - currentEvent?.start_time) / (1000 * 60 * 60 * 24)
          );
          const diffWeeks = Math.round(diffDays / 7);
          const diffMonths = Math.round(diffDays / 30); // Giả định mỗi tháng có 30 ngày

          for (let i = 0; i < count; i++) {
            const startDate = new Date(currentEvent?.start_time);
            const endDate = new Date(currentEvent?.end_time);

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
                "INSERT INTO event (user_id, title, description, start_time, end_time, recurring_id, synced) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                  user_id,
                  title,
                  description,
                  startDate,
                  endDate,
                  recurringId,
                  accessToken ? 1 : 0,
                ],
                (err, result) => {
                  if (err) reject(err);
                  else {
                    if (emails.length > 0 && accessToken) {
                      const values = emails.map((email) => [
                        result.insertId,
                        email,
                        "needsAction",
                      ]);

                      db.query(
                        "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                        [values],
                        (err) => {
                          if (err) {
                            reject(err);
                          }
                          events.push({
                            id: result.insertId,
                            title,
                            start_time: startDate,
                            end_time: endDate,
                          });
                          resolve();
                        }
                      );
                    } else {
                      events.push({
                        id: result.insertId,
                        title,
                        start_time: startDate,
                        end_time: endDate,
                      });
                      resolve();
                    }
                  }
                }
              );
            });

            promises.push(queryPromise);
          }

          return Promise.all(promises).then(() => events);
        };

        const updateEvent = async () => {
          try {
            db.query(
              "SELECT * FROM event WHERE recurring_id = ?",
              [recurringId],
              async (err, result) => {
                if (err) {
                  console.log(err);
                }
                const events = await new Promise((resolve, reject) => {
                  db.query(
                    "SELECT * FROM event WHERE recurring_id = ? ORDER BY start_time ASC",
                    [recurringId],
                    (err, result) => {
                      if (err) reject(err);
                      else resolve(result);
                    }
                  );
                });
                const currentEvent = events.find((event) => event.id === id);
                if (!currentEvent) {
                  console.error("Không tìm thấy sự kiện cần cập nhật!");
                  return;
                }
                const newStartDate = new Date(start_time);
                const newEndDate = new Date(end_time);

                // Tạo danh sách promises để cập nhật tất cả sự kiện
                const updatePromises = result.map((event) => {
                  return new Promise((resolve, reject) => {
                    const oldStart = new Date(event.start_time);

                    // Tính số ngày chênh lệch so với sự kiện đầu tiên
                    const diffDays = Math.round(
                      (oldStart - currentEvent?.start_time) /
                        (1000 * 60 * 60 * 24)
                    );

                    // Tạo thời gian mới cho sự kiện hiện tại
                    const updatedStart = new Date(newStartDate);
                    updatedStart.setDate(updatedStart.getDate() + diffDays);

                    const updatedEnd = new Date(newEndDate);
                    updatedEnd.setDate(updatedEnd.getDate() + diffDays);

                    // Cập nhật sự kiện hiện tại
                    db.query(
                      "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?",
                      [title, description, updatedStart, updatedEnd, event.id],
                      (updateErr, updateResult) => {
                        if (updateErr) reject(updateErr);
                        else resolve(updateResult);
                      }
                    );
                  });
                });

                // Đợi tất cả truy vấn cập nhật hoàn thành
                await Promise.all(updatePromises);
              }
            );
          } catch (error) {
            console.error("Lỗi trong updateEvent:", error);
          }
        };
        db.query(
          "SELECT * FROM event WHERE recurring_id = ?",
          [recurringId],
          async (err, result) => {
            if (err) res.json({ message: "không tìm thấy sự kiện!" });
            else {
              const listevents = await new Promise((resolve, reject) => {
                db.query(
                  "SELECT * FROM event WHERE recurring_id = ? ORDER BY start_time ASC",
                  [recurringId],
                  (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                  }
                );
              });
              const currentEvent = listevents.find((event) => event.id === id);

              (async () => {
                try {
                  await deleteOldEmailAttendees();
                  if (oldFrequency !== frequency) {
                    await deleteOldEvents();
                    await updateRecurringEvent();
                    const events = await insertNewEvents(
                      listevents,
                      currentEvent
                    );

                    if (accessToken) {
                      const { googleEventId } = await insertCalendarToGoogle(
                        frequency,
                        {
                          title,
                          description,
                          start_time: currentEvent.start_time,
                          end_time: currentEvent.end_time,
                          recurringId,
                        },
                        emails
                      );
                      db.query(
                        "UPDATE event SET synced = 1, google_event_id = ? WHERE recurring_id = ?",
                        [googleEventId, recurringId]
                      );
                    }

                    db.commit((err) => {
                      if (err) throw err;
                      res.status(200).json({
                        message: "Cập nhật thành công!",
                        data: events,
                      });
                    });
                  } else {
                    // change recuring
                    db.query(
                      "SELECT * FROM event WHERE id = ?",
                      [id],
                      async (err, result) => {
                        const googleEventId = result[0].google_event_id;

                        if (googleEventId && accessToken) {
                          const calendar = google.calendar({
                            version: "v3",
                            auth: oauth2Client,
                          });
                          const originalEvent = await calendar.events.get({
                            calendarId: "primary",
                            eventId: googleEventId,
                          });
                          const response = await calendar.events.update({
                            calendarId: "primary",
                            eventId: googleEventId,
                            resource: {
                              summary: title,
                              description: description,
                              start: {
                                dateTime: new Date(start_time).toISOString(),
                                timeZone: "Asia/Ho_Chi_Minh",
                              },
                              end: {
                                dateTime: new Date(end_time).toISOString(),
                                timeZone: "Asia/Ho_Chi_Minh",
                              },
                              attendees: emails.map((email) => ({
                                email,
                              })),
                              recurrence: originalEvent.data.recurrence, //Giữ nguyên RRULE
                            },
                            sendUpdates: "all",
                          });
                          if (response.status === 200) {
                            updateEvent();
                            if (emails.length > 0) {
                              const values = emails.map((email) => [
                                id,
                                email,
                                "needsAction",
                              ]);

                              db.query(
                                "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                                [values],
                                (err) => {
                                  if (err) {
                                    return res.status(500).json({
                                      message:
                                        "Lỗi lưu danh sách người tham gia",
                                      error: err,
                                    });
                                  }
                                  return res.json({
                                    message: "Cập nhật sự kiện thành công!",
                                  });
                                }
                              );
                            } else {
                              return res.json({
                                message: "Cập nhật sự kiện thành công!",
                              });
                            }
                          } else {
                            res.status(500).json({
                              message: "Lỗi cập nhật Google Calendar",
                            });
                          }
                        } else {
                          updateEvent();
                          res.json({ message: "Cập nhật sự kiện thành công!" });
                        }
                      }
                    );
                  }
                } catch (err) {
                  db.rollback(() => {
                    res.status(500).json({
                      message: "Lỗi khi cập nhật sự kiện",
                      error: err,
                    });
                  });
                }
              })();
            }
          }
        );
        // Xử lý cập nhật sự kiện lặp
      }
    );
  });
};

// meeting
export const listPollEvents = (req, res) => {
  const pollId = req.params.pollId;

  const query = `
    SELECT 
      pe.id,
      pe.poll_id,
      pe.title,
      pe.description,
      pe.start_time,
      pe.end_time,
      COUNT(pv.user_email) AS vote_count
    FROM meeting_poll pe
    LEFT JOIN poll_votes pv ON pe.id = pv.event_id
    WHERE pe.poll_id = ?
    GROUP BY pe.id
    ORDER BY vote_count DESC
  `;

  db.query(query, [pollId], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Lỗi truy vấn sự kiện trong poll",
        error: err,
      });
    }

    res.status(200).json({
      message: "Lấy danh sách sự kiện trong poll thành công",
      data: result,
    });
  });
};

//Tạo poll mới
export const createPoll = (req, res) => {
  const { title, description, created_by, options } = req.body;
  db.query(
    "INSERT INTO meeting_poll (title, description, created_by, created_at, finalized_event_id) VALUES (?, ?, ?, NOW(), false)",
    [title, description, created_by],
    (err, result) => {
      if (err)
        return res.status(500).json({ message: "Lỗi tạo poll", error: err });

      const pollId = result.insertId;
      const values = options.map((opt) => [
        pollId,
        opt.start_time,
        opt.end_time,
      ]);
      console.log(values);
      db.query(
        "INSERT INTO poll_options (poll_id, start_time, end_time) VALUES ?",
        [values],
        (err2) => {
          if (err2)
            return res
              .status(500)
              .json({ message: "Lỗi thêm lựa chọn", error: err2 });
          res.status(200).json({ message: "Tạo poll thành công", pollId });
        }
      );
    }
  );
};

// Xem chi tiết poll + tổng số lượt vote mỗi option
export const pollDetail = (req, res) => {
  const pollId = req.params.pollId;
  db.query(
    "SELECT * FROM meeting_poll WHERE id = ?",
    [pollId],
    (err, polls) => {
      if (err || polls.length === 0)
        return res.status(404).json({ message: "Không tìm thấy poll" });

      db.query(
        `SELECT po.*, COUNT(pv.id) AS vote_count FROM poll_options po
       LEFT JOIN poll_votes pv ON po.id = pv.option_id
       WHERE po.poll_id = ? GROUP BY po.id`,
        [pollId],
        (err2, options) => {
          if (err2)
            return res
              .status(500)
              .json({ message: "Lỗi truy vấn options", error: err2 });

          res.status(200).json({ poll: polls[0], options });
        }
      );
    }
  );
};

// 3. Vote lựa chọn
export const vote = (req, res) => {
  const { email, option_ids } = req.body;

  if (!email || !option_ids || option_ids.length === 0) {
    return res.status(400).json({ message: "Thiếu dữ liệu vote" });
  }

  // 1. Kiểm tra xem user có google_email không
  db.query(
    "SELECT google_email FROM user WHERE email = ?",
    [email],
    (errUser, userResult) => {
      if (errUser) {
        return res.status(500).json({
          message: "Lỗi server khi kiểm tra người dùng",
          error: errUser,
        });
      }

      if (userResult.length === 0 || !userResult[0].google_email) {
        return res.status(400).json({
          message: "Tài khoản của bạn chưa liên kết Google. Không thể vote!",
        });
      }

      // 2. Lấy poll_id từ 1 option bất kỳ (vì tất cả option_ids đều thuộc 1 poll)
      const firstOptionId = option_ids[0];

      db.query(
        "SELECT poll_id FROM poll_options WHERE id = ?",
        [firstOptionId],
        (errOption, optionResult) => {
          if (errOption || optionResult.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy option" });
          }

          const pollId = optionResult[0].poll_id;

          // 3. Kiểm tra xem email đã vote trong poll này chưa
          db.query(
            `SELECT pv.id FROM poll_votes pv
             JOIN poll_options po ON pv.option_id = po.id
             WHERE po.poll_id = ? AND pv.voter_email = ?`,
            [pollId, email],
            (errVote, voteCheck) => {
              if (errVote) {
                return res
                  .status(500)
                  .json({ message: "Lỗi kiểm tra vote", error: errVote });
              }

              if (voteCheck.length > 0) {
                return res
                  .status(400)
                  .json({ message: "Bạn đã vote rồi, không thể vote lại!" });
              }

              // 4. Nếu chưa vote, cho phép lưu
              const values = option_ids.map((id) => [id, email, new Date()]);
              db.query(
                "INSERT INTO poll_votes (option_id, voter_email, created_at) VALUES ?",
                [values],
                (errInsert) => {
                  if (errInsert) {
                    return res
                      .status(500)
                      .json({ message: "Lỗi khi lưu vote", error: errInsert });
                  }
                  res.status(200).json({ message: "Vote thành công!" });
                }
              );
            }
          );
        }
      );
    }
  );
};

const saveMeetingEventToDB = ({ eventID, meetLink, etag, id }) => {
  return new Promise((resolve, reject) => {
    db.query(
      `UPDATE event SET meet_link = ?, last_resource_id = ?, google_event_id = ?  WHERE id = ?`,
      [meetLink, etag, id, eventID],
      (err, result) => {
        if (err) {
          console.error("Lỗi khi lưu sự kiện:", err);
          return reject(err);
        }
        resolve(result);
      }
    );
  });
};

export const finalizePoll = (req, res) => {
  const { poll_id, created_by, accessToken } = req.body;
  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }
  if (!poll_id || !created_by) {
    return res.status(400).json({ message: "Thiếu dữ liệu cần thiết" });
  }

  db.beginTransaction((err) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Lỗi bắt đầu transaction", error: err });
    }

    // 1. Lấy thông tin poll
    db.query(
      "SELECT * FROM meeting_poll WHERE id = ?",
      [poll_id],
      (errPoll, pollResult) => {
        if (errPoll || pollResult.length === 0) {
          return db.rollback(() => {
            res
              .status(500)
              .json({ message: "Không tìm thấy poll", error: errPoll });
          });
        }

        const poll = pollResult[0]; // { title, description }

        // 2. Tìm option có nhiều vote nhất
        db.query(
          `SELECT po.*, COUNT(pv.id) AS vote_count
           FROM poll_options po
           LEFT JOIN poll_votes pv ON po.id = pv.option_id
           WHERE po.poll_id = ?
           GROUP BY po.id
           ORDER BY vote_count DESC`,
          [poll_id],
          (errOption, results) => {
            if (errOption || results.length === 0) {
              return db.rollback(() => {
                res.status(500).json({
                  message: "Không tìm thấy lựa chọn phù hợp",
                  error: errOption,
                });
              });
            }

            const highestVote = results[0].vote_count;
            const topOptions = results.filter(
              (opt) => opt.vote_count === highestVote
            );

            // 3. Random 1 option trong các topOptions
            const randomIndex = Math.floor(Math.random() * topOptions.length);
            const selectedOption = topOptions[randomIndex];

            // 3. Lấy danh sách người đã vote
            db.query(
              `SELECT DISTINCT u.google_email FROM poll_votes pv
                JOIN poll_options po ON pv.option_id = po.id
                JOIN user u ON pv.voter_email = u.email
                WHERE po.poll_id = ?`,
              [poll_id],
              (errVoters, voterList) => {
                if (errVoters) {
                  return db.rollback(() => {
                    res.status(500).json({
                      message: "Lỗi lấy danh sách người vote",
                      error: errVoters,
                    });
                  });
                }

                const attendees = voterList
                  .filter((voter) => voter.google_email) // bỏ những thằng NULL
                  .map((voter) => ({
                    email: voter.google_email,
                    responseStatus: "needsAction",
                  }));

                // 4. Đặt poll finalized
                db.query(
                  "UPDATE meeting_poll SET finalized_event_id = true WHERE id = ?",
                  [poll_id],
                  (errFinalize) => {
                    if (errFinalize) {
                      return db.rollback(() => {
                        res.status(500).json({
                          message: "Lỗi cập nhật trạng thái finalized",
                          error: errFinalize,
                        });
                      });
                    }

                    // 5. Tạo sự kiện mới
                    db.query(
                      "INSERT INTO recurring_events (frequency, count) VALUES (?, ?)",
                      ["none", 1],
                      (err, result) => {
                        if (err) {
                          return res.status(442).json({
                            message:
                              "Thêm sự kiện thất bại, vui lòng kiểm tra lại",
                          });
                        }
                        if (result) {
                          const recurringId = result.insertId;
                          db.query(
                            "INSERT INTO event (user_id, title, start_time, end_time, description, recurring_id, status) VALUES (?, ?, ?, ?, ?,?, ?)",
                            [
                              created_by,
                              poll.title,
                              selectedOption.start_time,
                              selectedOption.end_time,
                              poll.description,
                              recurringId,
                              "meeting",
                            ],
                            (errEvent, eventResult) => {
                              if (errEvent) {
                                return db.rollback(() => {
                                  res.status(500).json({
                                    message: "Lỗi tạo sự kiện",
                                    error: errEvent,
                                  });
                                });
                              }

                              const eventId = eventResult.insertId;

                              // 6. Thêm người tham gia vào event_attendees
                              if (attendees.length > 0) {
                                const values = attendees.map((att) => [
                                  eventId,
                                  att.email,
                                  att.responseStatus,
                                ]);

                                db.query(
                                  "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                                  [values],
                                  async (errInsert) => {
                                    if (errInsert) {
                                      return db.rollback(() => {
                                        res.status(500).json({
                                          message: "Lỗi lưu người tham gia",
                                          error: errInsert,
                                        });
                                      });
                                    }
                                    const calendar = google.calendar({
                                      version: "v3",
                                      auth: oauth2Client,
                                    });

                                    const googleEvent = {
                                      summary: poll.title,
                                      description: poll.description,
                                      start: {
                                        dateTime: new Date(
                                          selectedOption.start_time
                                        ).toISOString(),
                                        timeZone: "Asia/Ho_Chi_Minh",
                                      },
                                      end: {
                                        dateTime: new Date(
                                          selectedOption.end_time
                                        ).toISOString(),
                                        timeZone: "Asia/Ho_Chi_Minh",
                                      },
                                      attendees: attendees.map((attendee) => ({
                                        email: attendee.email,
                                      })),
                                      conferenceData: {
                                        createRequest: {
                                          requestId:
                                            "meet-" + new Date().getTime(),
                                          conferenceSolutionKey: {
                                            type: "hangoutsMeet",
                                          },
                                        },
                                      },
                                    };
                                    const response =
                                      await calendar.events.insert({
                                        calendarId: "primary",
                                        resource: googleEvent,
                                        sendUpdates: "all", // gửi thông báo mời tới attendees
                                        conferenceDataVersion: 1,
                                      });
                                    console.log(
                                      "data========",
                                      response.data.etag
                                    );
                                    if (response.status === 200) {
                                      const meetLink =
                                        response.data.conferenceData?.entryPoints?.find(
                                          (ep) => ep.entryPointType === "video"
                                        )?.uri;
                                      await saveMeetingEventToDB({
                                        eventID: eventId,
                                        meetLink,
                                        etag: response.data.etag,
                                        id: response.data.id,
                                      });

                                      db.commit((errCommit) => {
                                        if (errCommit) {
                                          return db.rollback(() => {
                                            res.status(500).json({
                                              message: "Lỗi commit transaction",
                                              error: errCommit,
                                            });
                                          });
                                        }

                                        res.status(200).json({
                                          message:
                                            "Chốt lịch, tạo sự kiện và chia sẻ thành công!",
                                        });
                                      });
                                    } else {
                                      db.commit((errCommit) => {
                                        if (errCommit) {
                                          return db.rollback(() => {
                                            res.status(500).json({
                                              message: "Lỗi commit transaction",
                                              error: errCommit,
                                            });
                                          });
                                        }

                                        res.status(422).json({
                                          message:
                                            "đồng bộ lên google calendar không thành công",
                                        });
                                      });
                                    }
                                  }
                                );
                              } else {
                                db.commit((errCommit) => {
                                  if (errCommit) {
                                    return db.rollback(() => {
                                      res.status(500).json({
                                        message: "Lỗi commit transaction",
                                        error: errCommit,
                                      });
                                    });
                                  }
                                  res.status(200).json({
                                    message:
                                      "Chốt lịch và tạo sự kiện thành công (không có người chia sẻ)",
                                  });
                                });
                              }
                            }
                          );
                        }
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
};

export const updatePoll = (req, res) => {
  const { poll_id, title, description } = req.body;

  if (!poll_id || !title) {
    return res.status(400).json({ message: "Thiếu dữ liệu cần thiết" });
  }

  db.query(
    `UPDATE meeting_poll SET title = ?, description = ?  WHERE id = ?`,
    [title, description, poll_id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ message: "Lỗi server", error: err });
      }
      return res.status(200).json({ message: "Cập nhật poll thành công" });
    }
  );
};
