import cloudinary from "cloudinary";
import jwt from "jsonwebtoken";
import { db } from "./../../index.js";
import { generateOTP } from "./../../common/opt.js";
import { sendEmailForgotPassword } from "./../../common/nodemailer.js";
import bcrypt from "bcrypt";
import { role as roleAccount } from "../../common/index.js";

cloudinary.config({
  cloud_name: "smile159",
  api_key: "678772438397898",
  api_secret: "zvdEWEfrF38a2dLOtVp-3BulMno",
});


export const register = async (req, res) => {
  if (
    typeof req.body.email === "undefined" ||
    typeof req.body.password === "undefined" ||
    typeof req.body.confirm === "undefined"
  ) {
    res.status(422).json({ message: "dữ liệu không hợp lệ" });
    return;
  }
  let { email, password, confirm } = req.body;
  if (password !== confirm) {
    res.status(422).json({ message: "password không trùng hợp" });
    return;
  }
  password = bcrypt.hashSync(password, 10);
  db.query(
    "SELECT * FROM user WHERE email = ?",
    [email],
    (err, result) => {
      if (err) {
        console.log(err);
      }
      if (result) {
        let user = result[0];
        if (!!user) {
          res.status(422).json({ message: "email đã tồn tại" });
          return;
        }
      }
    }
  );
  const role = roleAccount.USER;
  db.query(
    "INSERT INTO user (email, password, role) VALUES (?,?,?)",
    [email, password, role],
    (err, result) => {
      if (err) {
        res.status(422).json({ message: "đăng ký thất bại, vui lòng thử lại" });
      }
      if (result) {
        res.status(200).json({ message: "đăng ký thành công" });
      }
    }
  );
};

export const login = (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM user where email = ?",
    [email],
    (err, result) => {
      if (err) {
        console.log(err);
      }
      if (result) {
        console.log(result);
        const user = { id: result[0]?.id, email: result[0]?.email };
        if (!user.id) {
          res
            .status(422)
            .json({ message: "Tài khoản hoặc mật khẩu không chính xácccc" });
          return;
        }
        if (!bcrypt.compareSync(password, result[0].password)) {
          res
            .status(422)
            .json({ message: "Tài khoản hoặc mật khẩu không chính xác" });
          return;
        }

        let token = jwt.sign(
          {
            email: email,
            role: result.role,
            iat: Math.floor(Date.now() / 1000) - 60 * 30,
          },
          "secret",
          { expiresIn: "1d" }
        );
       
        res.send({ token, user });
      }
    }
  );
};

export const refreshToken = (req, res) => {
  const { refreshToken } = req.body;
  try {
    const user = jwt.verify(refreshToken, "re-secret");
    if (user) {
      const token = jwt.sign(
        {
          username: user.username,
          iat: Math.floor(Date.now() / 1000) - 60 * 30,
        },
        "secret",
        { expiresIn: "1 days" }
      );
      let refreshToken = jwt.sign(
        {
          username: user.username,
          iat: Math.floor(Date.now() / 1000) - 60 * 30,
        },
        "re-secret",
        { expiresIn: "10 days" }
      );
      const response = {
        token,
        refreshToken,
      };

      res.status(200).json(response);
    } else {
      res.status(404).send("Invalid request");
    }
  } catch (error) {
    res.status(422).send("refreshToken Invalid");
  }
};

export const profile = (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];
  try {
    const user = jwt.verify(token, "secret");
    db.query(
      "SELECT * FROM user WHERE email=?",
      [user.email],
      (err, result) => {
        const { password, token_forgot, ...user } = result[0];
        if (err) {
          console.log(err);
        } else {
          res.send(user);
        }
      }
    );
  } catch (error) {
    res.status(401).send({message: "token hết hạn"});
  }
};



export const requestForgotPassword = async (req, res) => {
  if (typeof req.body.email === "undefined") {
    res.json({ message: "Invalid data" });
    return;
  }
  let email = req.body.email;
  let userFind = null;
  try {
    db.query(
      "select * from user where email=?",
      [email],
      async (err, result) => {
        if (err) {
          gm;
          console.log(err);
        }
        if (result) {
          userFind = result[0];
          if (!userFind) {
            res.status(422).json({ message: "không tìm thấy email" });
            return;
          }
          let token = generateOTP();
          let sendEmail = await sendEmailForgotPassword(email, token);
          if (!sendEmail) {
            res.status(500).json({ message: "gửi mail thất bại" });
            return;
          }
          db.query(
            "UPDATE user SET token_forgot = ? WHERE email = ?",
            [token, email],
            (err, result) => {
              if (err) {
                console.log(err);
              }
              if (result) {
                res.status(200).json({ message: "gửi mail thành công" });
              }
            }
          );
        }
      }
    );
  } catch (error) {
    console.log(error);
  }
};

export const verifyForgotPassword = (req, res) => {
  if (
    typeof req.body.email === "undefined" ||
    typeof req.body.otp === "undefined"
  ) {
    res.status(402).json({ message: "vui lòng nhập đủ dữ liệu" });
    return;
  }

  let { email, otp } = req.body;
  let userFind = null;

  db.query("select * from user where email=?", [email], (err, result) => {
    if (err) {
       res.status(422).json({ message: "không tồn tại email hợp lệ" });
    }
    if (result) {
      userFind = result[0];

      if (userFind.token_forgot !== otp) {
        res.status(422).json({ message: "OTP không chính xác" });
        return;
      }
      res.status(200).json({ message: "success", otp: otp });
    }
  });
};

export const forgotPassword = async (req, res) => {
  if (typeof req.body.newPassword === "undefined") {
    res.status(402).json({ message: "vui lòng nhập đầy đủ dữ liệu" });
    return;
  }
  let { email, newPassword } = req.body;
  const hashPassword = bcrypt.hashSync(newPassword, 10);
  db.query("select * from user where email=?", [email], (err, result) => {
    if (err) {
      res.status(422).json({ message: "không tồn tại email hợp lệ" });
    }
    if (result) {
      db.query(
        "update user set password=? where email=?",
        [hashPassword, email],
        (err, result) => {
          if (err) {
            res.status(422).json({ message: "không tìm thấy email phù hợp" });
          }
          if (result) {
            res.status(200).json({ message: "đổi mật khẩu thành công" });
          }
        }
      );
    }
  });
};

export const profileById = (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM user WHERE id=?", [id], (err, result) => {
    if (err) {
      res.status(422).json({ message: "không tìm thấy id" });
    } else {
      res.send(result[0]);
    }
  });
};export const getUserEmails = (req, res) => {
  const userId = req.params.id;
  const sql = "SELECT id, email FROM user WHERE id != ?";

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Lỗi khi lấy danh sách email", error: err });
    }
    res.status(200).json({ users: results });
  });
};
