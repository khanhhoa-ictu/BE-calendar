import jwt from "jsonwebtoken";
import { db } from "../../index.js";
import { role as roleAccount } from "../../common/index.js";
import bcrypt from "bcrypt";

export const getListUser = (req, res) => {
  db.query(
    `SELECT * FROM user WHERE role=${roleAccount.USER}`,
    (err, result) => {
      if (err) {
        return res
          .status(422)
          .json({ message: "không tìm thấy danh sách người dùng" });
      }
      if (result) {
        const newData = result.map((item) => {
          return {
            email: item.email,
            role: item.role,
            id: item.id,
          };
        });
        res.send(newData);
      }
    }
  );
};

export const detailUser = (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM user WHERE id=?", [id], (err, result) => {
    if (err) {
      return res
        .status(422)
        .json({
          message: "Không tìm thấy thông tin người dùng, vui lòng thử lại",
        });
    }
    if (result) {
      res.send({ data: result[0], message: "thành công" });
    }
  });
};

export const deleteUser = (req, res) => {
  const id = req.params.id;
  const authHeader = req.headers.authorization;
  const token = authHeader.split(" ")[1];
  let user;
  try {
    user = jwt.verify(token, "secret");
  } catch (error) {
    return res.status(422).json({ message: "token không hợp lệ" });
  }
  db.query("SELECT * FROM user WHERE email=?", [user.email], (err, result) => {
    if (err) {
      return res
        .status(422)
        .json({
          message: "Không tìm thấy thông tin người dùng, vui lòng thử lại",
        });
    }
    if (result) {
      user = result[0];
      if (user.role !== roleAccount.ADMIN) {
        return res.status(403).json("bạn không có quyền");
      }
      db.query("DELETE FROM user WHERE id=?", [id], (err, result) => {
        if (err) {
          return res
            .status(422)
            .json({
              message: "Không tìm thấy thông tin người dùng, vui lòng thử lại",
            });
        }
        if (result) {
          res.send({ message: "xoá người dùng thành công" });
        }
      });
    }
  });
};

export const addUser = (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader.split(" ")[1];
  let user = null;
  try {
    user = jwt.verify(token, "secret");
  } catch (error) {
    return res.status(422).json({ message: "token không hợp lệ" });
  }
  let { email, password } = req.body;
  password = bcrypt.hashSync(password, 10);

  const role = roleAccount.USER;
  db.query("SELECT * FROM user WHERE email=?", [user.email], (err, result) => {
    if (err) {
      res.status(422).json({
        message: "thêm người dùng thất bại, vui lòng thử lại",
      });
    }
    if (result) {
      user = result[0];
      if (user.role !== roleAccount.ADMIN) {
        return res.status(403).json("bạn không có quyền");
      }
      db.query(
        "INSERT INTO user (email, password, role) VALUES (?,?,?)",
        [email, password, role],
        (err, result) => {
          if (err) {
            res.status(422).json({
              message: "thêm người dùng thất bại, vui lòng thử lại",
            });
          }
          if (result) {
            res.status(200).json({ message: "thêm người dùng thành công" });
          }
        }
      );
    }
  });
};

export const updateUser = (req, res) => {
  const { email, id, password } = req.body;

  db.query(
    "SELECT * FROM user WHERE email = ? AND id != ?",
    [email, id],
    (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Lỗi truy vấn database" });
      }

      if (result.length > 0) {
        return res.status(422).json({ message: "Email đã tồn tại" });
      }

      // Hash password
      const hashedPassword = bcrypt.hashSync(password, 10);

      // Update email + hashed password
      db.query(
        "UPDATE user SET email = ?, password = ? WHERE id = ?",
        [email, hashedPassword, id],
        (err, result) => {
          if (err) {
            return res
              .status(422)
              .json({ message: "Không tìm thấy người dùng phù hợp" });
          }

          return res.status(200).json({
            message: "Cập nhật thông tin người dùng thành công",
          });
        }
      );
    }
  );
};
