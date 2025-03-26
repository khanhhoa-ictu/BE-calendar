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
        "UPDATE user SET refresh_token_google = ? WHERE id = ?",
        [refresh_token, userId],
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
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        res.json({ accessToken: credentials.access_token });
      } catch (error) {
        res.status(500).json({ message: "Lỗi lấy access token mới", error });
      }
    }
  );
};

export const registerWebhook  = async(req, res) => {
  try {
    const { accessToken } = req.body;
    oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const webhookId = `webhook-${Date.now()}`; // Sử dụng timestamp để tạo ID duy nhất
    const response = await calendar.events.watch({
      auth: oauth2Client,
      calendarId: "primary", // Dùng "primary" thay vì email
      requestBody: {
        id: webhookId,
        type: "web_hook",
        address: "https://d8cc-2405-4802-1bd7-1860-1c09-22b5-c67-5642.ngrok-free.app/webhook",
      },
    });

   

    res.json({ message: "Webhook registered!", data: response.data });
  } catch (error) {
    console.error("Lỗi đăng ký Webhook:", error);
    res.status(500).json({ error: error.message });
  }
};

export const webhookGoogle = async(req, res) =>{
  console.log("Nhận thông báo từ Google Calendar:", req.headers);

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const response = await calendar.events.list({
      calendarId: "primary",
      maxResults: 5,
      orderBy: "updated",
      singleEvents: true,
    });

    const events = response.data.items;

    events.forEach((event) => {
      db.query(
        "INSERT INTO event (google_event_id, title, start_time, end_time, description) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=?, start_time=?, end_time=?, description=?",
        [
          event.id,
          event.summary,
          event.start.dateTime,
          event.end.dateTime,
          event.description,
          event.summary,
          event.start.dateTime,
          event.end.dateTime,
          event.description,
        ],
        (err) => {
          if (err) console.error("Lỗi lưu sự kiện vào DB:", err);
        }
      );
    });

    res.json({ message: "Sự kiện đã đồng bộ vào database" });
  } catch (error) {
    console.error("Lỗi đồng bộ sự kiện:", error);
    res.status(500).json({ error: error.message });
  }
}