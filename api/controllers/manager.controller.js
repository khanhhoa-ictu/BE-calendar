import jwt from "jsonwebtoken";
import { db } from "../../index.js";


export const getListUser = (req, res) => {
  db.query("SELECT * FROM user ", (err, result) => {
    if (err) {
      console.log(err);
    }
    if (result) {
      res.send(result);
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
    return res.status(422).json({ msg: "token không hợp lệ" });
  }
  db.query(
    "SELECT * FROM user WHERE username=?",
    [user.username],
    (err, result) => {
      if (err) {
        console.log(err);
      }
      if (result) {
        user = result[0];
        if (user.role !== "admin") {
          return res.status(403).json("bạn không có quyền");
        }
        db.query("DELETE FROM user WHERE id=?", [id], (err, result) => {
          if (err) {
            console.log(err);
          }
          if (result) {
            res.send("delete user success");
          }
        });
      }
    }
  );
};
