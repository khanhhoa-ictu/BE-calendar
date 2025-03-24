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

        if (result) {
          const recurringId = result.insertId;
          let events = [];

          try {
            await Promise.all(
              Array.from({ length: count }, async (_, i) => {
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

                return new Promise((resolve, reject) => {
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
                      events.push({
                        id: result.insertId,
                        title,
                        start_time: startDate,
                        end_time: endDate,
                      });
                      resolve();
                    }
                  );
                });
              })
            );
            if (accessToken) {
              const googleEventId = await insertCalendarToGoogle(frequency, {
                title,
                description,
                start_time,
                end_time,
                recurringId,
              });
              db.query(
                "UPDATE event SET google_event_id = ?, synced = ? WHERE recurring_id = ?",
                [googleEventId, 1, recurringId],
                (err) => {
                  if (err) {
                    return res.status(442).json({
                      message: "Đồng bộ lên Google Calendar không thành công",
                    });
                  }
                  res.status(200).json({
                    message: "Chuỗi sự kiện đã được tạo!",
                    data: events,
                  });
                }
              );
            } else {
              res.status(200).json({
                message: "Chuỗi sự kiện đã được tạo!",
                data: events,
              });
            }
          } catch (error) {
            res.status(442).json({
              message: "Thêm sự kiện thất bại, vui lòng kiểm tra lại",
            });
          }
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
              };
              const response = await calendar.events.insert({
                calendarId: "primary",
                resource: googleEvent,
              });
              const googleEventId = response.data.id;
              if (response?.status === 200) {
                db.query(
                  "UPDATE event SET  google_event_id = ?, synced = ? WHERE id=?",
                  [googleEventId, 1, insertedId],
                  (err, result) => {
                    if (err) {
                      res.status(442).json({
                        message: "đông bộ lên google calendar không thành công",
                      });
                    }
                  }
                );
              }
            }

            db.query(
              "SELECT * FROM event WHERE id = ?",
              [insertedId],
              (err, result) => {
                if (result) {
                  res.status(200).json({
                    data: [result[0]],
                    message: "Thêm sự kiện thành công",
                  });
                }
              }
            );
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
  const { id, title, description, start_time, end_time, accessToken } =
    req.body;
  if (accessToken) {
    oauth2Client.setCredentials({ access_token: accessToken });
  }
  db.query("SELECT * FROM event WHERE id = ?", [id], async (err, result) => {
    if (result) {
      const googleEventId = result[0].google_event_id;
      if (googleEventId) {
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const instances = await calendar.events.instances({
          calendarId: "primary",
          eventId: googleEventId, // ID của sự kiện gốc
        });

        // Tìm instance cụ thể cần cập nhật dựa trên thời gian bắt đầu
        const instanceToUpdate = instances.data.items.find((event) => {
          const eventStart = new Date(event.start.dateTime).getTime();
          const dbStart = new Date(result[0]?.start_time).getTime();
          return eventStart === dbStart;
        });

        const response = await calendar.events.patch({
          calendarId: "primary",
          eventId: instanceToUpdate?.id,
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
          },
        });
        if (response.status === 200) {
          db.query(
            "UPDATE event SET  title = ?, description = ?, start_time = ?, end_time = ? WHERE id=?",
            [title, description, start_time, end_time, id]
          );
          res.json({ message: "Cập nhật sự kiện thành công!" });
        } else {
          res.status(500).json({ message: "Lỗi cập nhật Google Calendar" });
        }

        return;
      }
      db.query(
        "UPDATE event SET  title = ?, description = ?, start_time = ?, end_time = ? WHERE id=?",
        [title, description, start_time, end_time, id],
        (err, result) => {
          if (err) {
            res.status(422).json({ message: "cập nhật thông tin thất bại" });
          }
          if (result) {
          }
        }
      );
    }
    if (err) {
      res.status(422).json({ message: "không tìm thấy sự kiện" });
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
  db.query(
    "SELECT * FROM recurring_events WHERE id = ?",
    [id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ message: "Lỗi truy vấn database" });
      }
      if (result) {
        res
          .status(200)
          .json({ message: "Lấy sự kiện lặp thành công", data: result[0] });
      }
    }
  );
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

const insertCalendarToGoogle = async (type, event) => {
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
  };
  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: googleEvent,
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

                if (!googleEventId)
                  return reject(new Error("Thiếu Google Event ID"));

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
                    // Xóa tất cả sự kiện có cùng recurring_id trong database
                    db.query(
                      "DELETE FROM event WHERE recurring_id = ?",
                      [recurringId],
                      (err, result) => {
                        if (err) return reject(err);
                        resolve(); // Đảm bảo Promise kết thúc
                      }
                    );
                  } else {
                    reject(
                      new Error("Không thể xóa sự kiện trên Google Calendar")
                    );
                  }
                } catch (error) {
                  reject(error); // Bắt lỗi API
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

        const insertNewEvents = async () => {
          let events = [];
          let promises = [];
          let startDate = new Date(start_time);
          let endDate = new Date(end_time);

          if (frequency === "none") {
            db.query(
              "INSERT INTO event (user_id, title, description, start_time, end_time, recurring_id) VALUES (?, ?, ?, ?, ?, ?)",
              [user_id, title, description, startDate, endDate, recurringId],
              (err, result) => {
                if (err) reject(err);
                else {
                  events.push({
                    id: result.insertId,
                    title,
                    start_time: startDate,
                    end_time: endDate,
                  });

                  return Promise.resolve(events);
                }
              }
            );
            return;
          }

          for (let i = 0; i < count; i++) {
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
                  1,
                ],
                (err, result) => {
                  if (err) reject(err);
                  else {
                    events.push({
                      id: result.insertId,
                      title,
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

        const updateEvent = async () => {
          try {
            db.query(
              "SELECT * FROM event WHERE recurring_id = ?",
              [recurringId],
              async (err, result) => {
                if (err) {
                  console.log(err);
                }
                const firstStartTime = new Date(result[0].start_time);
                const newStartDate = new Date(start_time);
                const newEndDate = new Date(end_time);

                // Tạo danh sách promises để cập nhật tất cả sự kiện
                const updatePromises = result.map((event) => {
                  return new Promise((resolve, reject) => {
                    const oldStart = new Date(event.start_time);

                    // Tính số ngày chênh lệch so với sự kiện đầu tiên
                    const diffDays = Math.round(
                      (oldStart - firstStartTime) / (1000 * 60 * 60 * 24)
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

        // Xử lý cập nhật sự kiện lặp
        (async () => {
          try {
            if (oldFrequency !== frequency) {
              await deleteOldEvents();
              await updateRecurringEvent();
              const events = await insertNewEvents();
              const googleEventId = await insertCalendarToGoogle(frequency, {
                title,
                description,
                start_time,
                end_time,
                recurringId,
              });
              db.query(
                "UPDATE event SET synced = 1, google_event_id = ? WHERE recurring_id = ?",
                [googleEventId, recurringId]
              );
              db.commit((err) => {
                if (err) throw err;
                res
                  .status(200)
                  .json({ message: "Cập nhật thành công!", data: events });
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
                        recurrence: originalEvent.data.recurrence, //Giữ nguyên RRULE
                      },
                    });
                    if (response.status === 200) {
                      updateEvent();
                      res.json({ message: "Cập nhật sự kiện thành công!" });
                    } else {
                      res
                        .status(500)
                        .json({ message: "Lỗi cập nhật Google Calendar" });
                    }
                  } else {
                    updateEvent();
                  }
                }
              );
            }
          } catch (err) {
            db.rollback(() => {
              res
                .status(500)
                .json({ message: "Lỗi khi cập nhật sự kiện", error: err });
            });
          }
        })();
      }
    );
  });
};
