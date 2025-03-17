import { google } from "googleapis";
import dotenv from "dotenv";
import axios from "axios";
import { db } from "./../../index.js";

dotenv.config();

// Cấu hình OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Tạo URL đăng nhập Google OAuth2
export const getAuthURL = () => {
  const scopes = ["https://www.googleapis.com/auth/calendar"];
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });
};

export const loginGoogle = (req, res) => {
  res.redirect(getAuthURL());
};

export const googleCallback = async (req, res) => {
  const { code } = req.body;

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

    // Gửi token về cho FE hoặc lưu vào DB
    res.json({ access_token, refresh_token, expires_in });
  } catch (error) {
    console.error(
      "Lỗi lấy token từ Google:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Lỗi khi lấy token" });
  }
};

const getRecurrenceRule = (frequency) => {
  let rule = `RRULE:FREQ=${frequency.toUpperCase()}`;
  return rule;
};

export const syncCalendar = async (req, res) => {
  const { accessToken, refreshToken, userId } = req.body;
  if (!accessToken || !refreshToken) {
    return res
      .status(401)
      .json({ message: "Người dùng chưa đăng nhập Google" });
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // Lấy danh sách sự kiện từ DB
  db.query(
    `SELECT e.* FROM event e
   LEFT JOIN recurring_events r ON e.recurring_id = r.id
   WHERE e.user_id = ? AND e.synced = 0
   AND e.id = (SELECT MIN(e2.id) FROM event e2 WHERE e2.recurring_id = e.recurring_id)`, // Nhóm theo recurring_id để tránh tạo trùng lặp,
    [userId],
    async (err, events) => {
      if (err)
        return res.status(500).json({ message: "Lỗi lấy sự kiện", error: err });
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
             
              const recurrenceRule = getRecurrenceRule(
                recurrenceType,
              );
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
                recurrence: recurrenceType === "none" ? undefined :[recurrenceRule],
              };
              const response = await calendar.events.insert({
                calendarId: "primary",
                resource: googleEvent,
              });
              // 🔹 Nếu không có lặp lại, tạo sự kiện bình thường
              if (recurrenceType === "none") {
                if (response.status === 200) {
                  db.query("UPDATE event SET synced = 1 WHERE id = ?", [
                    event.id,
                  ]);
                }
              } else {
                if (response.status === 200) {
                  db.query(
                    "UPDATE event SET synced = 1 WHERE recurring_id = ?",
                    [event.recurring_id]
                  );
                }
              }
            }
          );
        }

        res.json({ message: "Đồng bộ lịch thành công!" });
      } catch (error) {
        res.status(500).json({ message: "Lỗi đồng bộ", error });
      }
    }
  );
};

export const checkSyncCalendar = (req, res) =>{
  const user_id = req.params.user_id;
  db.query("SELECT * FROM event WHERE user_id = ?  AND synced = 0", [user_id],(err,result)=>{
    if(result.length === 0){
      res.status(200).json({ message: "dữ liệu đã được đồng bộ", data: [] });
    }
    if(result.length !== 0){
      res.status(200).json({ message: "dữ liệu chưa được đồng bộ hết", data: result });
    }
    if(err){
      res.status(500).json({ message: "Lỗi không tìm thấy dữ liệu" });
    }
  })
}