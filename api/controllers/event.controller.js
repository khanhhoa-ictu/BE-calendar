import { db } from "./../../index.js";

export const addEvent = async (req, res) => {
  const { user_id, title, description, start_time, end_time } = req.body;

  if (!user_id || !title || !start_time || !end_time) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  db.query(
    "INSERT INTO event (user_id, title, description, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
    [user_id, title, description, start_time, end_time],
    (err, result) => {
      if (err) {
        res
          .status(200)
          .json({ message: "Thêm sự kiện thất bại vui lòng kiểm tra lại" });
      }
      if (result) {
        const insertedId = result.insertId;
        db.query(
          "SELECT * FROM event WHERE id = ?",
          [insertedId],
          (err, result) => {
            if (result) {
              res
                .status(200)
                .json({ data: result[0], message: "Thêm sự kiện thành công" });
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
  const { id, title, description, start_time, end_time } = req.body;
  console.log(title);
  db.query(
    "UPDATE event SET  title = ?, description = ?, start_time = ?, end_time = ? WHERE id=?",
    [title, description, start_time, end_time, id],
    (err, result) => {
      if (err) {
        console.log(err);
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
