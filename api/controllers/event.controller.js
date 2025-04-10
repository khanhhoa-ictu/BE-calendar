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
                        "accepted",
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
            const googleEventId = await insertCalendarToGoogle(
              frequency,
              { title, description, start_time, end_time, recurringId },
              emails
            );

            await new Promise((resolve, reject) => {
              db.query(
                "UPDATE event SET google_event_id = ?, synced = ? WHERE recurring_id = ?",
                [googleEventId, 1, recurringId],
                (err) => (err ? reject(err) : resolve())
              );
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
                  responseStatus: "accepted",
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
                        "accepted",
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
            }
          }
        );
      }
    }
  );
};

export const listEventByUser = (req, res) => {
  const user_id = req.params.user_id;
  db.query(
    "SELECT * FROM event where user_id = ?",
    [user_id],
    (err, result) => {
      if (err) {
        res.status(500).json({ message: "Lỗi server!" });
      }
      if (result) {
        res.status(200).json({ data: result, message: "thành công" });
      }
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

    if (!googleEventId) {
      // Nếu sự kiện không liên kết với Google, chỉ cập nhật database
      return db.query(
        "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?",
        [title, description, start_time, end_time, id],
        (err) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Cập nhật database thất bại", error: err });
          }
          res
            .status(200)
            .json({ message: "Cập nhật thành công trong database!" });
        }
      );
    }

    try {
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      // Lấy danh sách instances để tìm event cần cập nhật
      const instances = await calendar.events.instances({
        calendarId: "primary",
        eventId: googleEventId,
      });
      if (!instances.data.items || instances.data.items.length === 0) {
        return res
          .status(404)
          .json({ message: "Không tìm thấy instance của sự kiện" });
      }

      // Tìm instance có thời gian bắt đầu trùng với database
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

      // Cập nhật sự kiện trên Google Calendar
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
            responseStatus: "accepted",
          })),
        },
        sendUpdates: "all",
      });

      if (response.status === 200) {
        // Nếu cập nhật trên Google thành công, cập nhật cả database
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
            if (googleEventId === response.data.id) {
              db.query(
                "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ?",
                [title, description, start_time, end_time, id],
                (err) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Cập nhật database thất bại",
                      error: err,
                    });
                  }
                  res.status(200).json({
                    message: "Cập nhật thành công trên Google và database!",
                  });
                }
              );
            } else {
              db.query(
                "UPDATE event SET title = ?, description = ?, start_time = ?, end_time = ?, instance_id = ?  WHERE id = ?",
                [
                  title,
                  description,
                  start_time,
                  end_time,
                  response.data.id,
                  id,
                ],
                (err) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Cập nhật database thất bại",
                      error: err,
                    });
                  }
                  res.status(200).json({
                    message: "Cập nhật thành công trên Google và database!",
                  });
                }
              );
            }
            if (emails.length > 0) {
              const values = emails.map((email) => [id, email, "accepted"]);

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
                  res.status(200).json({
                    message: "Sự kiện đã được tạo",
                  });
                }
              );
            }
          }
        );
      } else {
        res.status(500).json({ message: "Lỗi cập nhật Google Calendar" });
      }
    } catch (error) {
      res
        .status(500)
        .json({ message: "Lỗi khi gọi Google API", error: error.message });
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
    attendees: emails.map((email) => ({ email, responseStatus: "accepted" })),
  };
  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: googleEvent,
    sendUpdates: "all",
  });
  return response.data.id;
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
                      "accepted",
                    ]);

                    db.query(
                      "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                      [values],
                      (err) => {
                        if (err) {
                          reject(err)
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
                        "accepted",
                      ]);

                      db.query(
                        "INSERT INTO event_attendees (event_id, email, response_status) VALUES ?",
                        [values],
                        (err) => {
                          if (err) {
                            reject(err)
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
                      const googleEventId = await insertCalendarToGoogle(
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
                                responseStatus: "accepted",
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
                                "accepted",
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
