import { db } from "./../../index.js";

export const addEvent = async (req, res) => {
  const { user_id, title, description, frequency, start_time, end_time } =
    req.body;

  if (!user_id || !title || !start_time || !end_time) {
    return res.status(400).json({ message: "bạn cần nhập đầy đủ thông tin" });
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
                  startDate.setDate(startDate.getDate() + i * 28);
                  endDate.setDate(endDate.getDate() + i * 28);
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

            res.status(200).json({
              message: "Chuỗi sự kiện đã được tạo!",
              data: events,
            });
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
          (err, result) => {
            if (err) {
              res
                .status(442)
                .json({
                  message: "Thêm sự kiện thất bại vui lòng kiểm tra lại",
                });
            }
            if (result) {
              const insertedId = result.insertId;
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
          }
        );
      }
    }
  );
};

export const listEventByUser = (req, res) => {
  const user_id = req.params.user_id;
  db.query(
    "SELECT * FROM event where user_id  = ?",
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
  const { id, title, description, start_time, end_time } = req.body;
  db.query(
    "UPDATE event SET  title = ?, description = ?, start_time = ?, end_time = ? WHERE id=?",
    [title, description, start_time, end_time, id],
    (err, result) => {
      if (err) {
        res.status(422).json({ message: "cập nhật thông tin thất bại" });
      }
      if (result) {
        db.query("SELECT * FROM event WHERE id = ?", [id], (err, result) => {
          if (result) {
            res.status(200).json({
              data: result[0],
              message: "cập nhật thông tin thành công",
            });
          }
        });
      }
    }
  );
};

export const deleteEvent = (req, res) => {
  const id = req.params.id;
  db.query("DELETE FROM event WHERE id=?", [id], (err, result) => {
    if (err) {
      res.status(422).json({ message: "xoá thất bại" });
    }
    if (result) {
      res.status(200).json({
        message: "xoá sự kiện thành công",
      });
    }
  });
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
  const recurringId = req.params.id;
  db.beginTransaction((err) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Lỗi khi bắt đầu transaction", error: err });
    }

    // Xoá tất cả sự kiện con trước
    db.query(
      "DELETE FROM event WHERE recurring_id = ?",
      [recurringId],
      (err, result) => {
        if (err) {
          return db.rollback(() => {
            res
              .status(500)
              .json({ message: "Lỗi khi xoá sự kiện con", error: err });
          });
        }

        // Xoá sự kiện lặp
        db.query(
          "DELETE FROM recurring_events WHERE id = ?",
          [recurringId],
          (err, result) => {
            if (err) {
              return db.rollback(() => {
                res
                  .status(500)
                  .json({ message: "Lỗi khi xoá sự kiện lặp", error: err });
              });
            }

            db.commit((err) => {
              if (err) {
                return db.rollback(() => {
                  res.status(500).json({
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
};

export const updateRecurringEvent = (req, res) => {
  const recurringId = req.params.id;
  const { user_id, frequency, title, description, start_time, end_time, id } =
    req.body;

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
              "DELETE FROM event WHERE recurring_id = ?",
              [recurringId, id],
              (err, result) => {
                if (err) reject(err);
                else resolve();
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
          if(frequency === "none"){
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
                 return Promise.resolve(events)
                }
              }
            );
            return
          }
          for (let i =  0; i < count; i++) {
            let startDate = new Date(start_time);
            let endDate = new Date(end_time);

            if (frequency === "daily") {
              startDate.setDate(startDate.getDate() + i);
              endDate.setDate(endDate.getDate() + i);
            } else if (frequency === "weekly") {
              startDate.setDate(startDate.getDate() + i * 7);
              endDate.setDate(endDate.getDate() + i * 7);
            } else if (frequency === "monthly") {
              startDate.setDate(startDate.getDate() + i * 28);
              endDate.setDate(endDate.getDate() + i * 28);
            }

            const queryPromise = new Promise((resolve, reject) => {
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
                    resolve();
                  }
                }
              );
            });

            promises.push(queryPromise);
          }

          return Promise.all(promises).then(() => events);
        };

        // Xử lý cập nhật sự kiện lặp
        (async () => {
          try {
            if (oldFrequency !== frequency){
              await deleteOldEvents();
              await updateRecurringEvent();
              const events = await insertNewEvents();
              db.commit((err) => {
                if (err) throw err;
                res
                  .status(200)
                  .json({ message: "Cập nhật thành công!", data: events });
              });
            }else{
              db.query(
                "UPDATE event SET  title = ?, description = ?, start_time = ?, end_time = ? WHERE id=?",
                [title, description, start_time, end_time, id],
                (err, result) => {
                  if (err) {
                    res.status(422).json({ message: "cập nhật thông tin thất bại" });
                  }
                  if (result) {
                    db.query("SELECT * FROM event WHERE id = ?", [id], (err, result) => {
                      if (result) {
                        res.status(200).json({
                          data: result[0],
                          message: "cập nhật thông tin thành công",
                        });
                      }
                    });
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
