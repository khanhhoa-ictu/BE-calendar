import moment from "moment";

export const role = {
  USER: "1",
  ADMIN: "2",
};
export const getGoogleUserInfo = async (accessToken) => {
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await response.json();
    return data.email; // Trả về email Google của người dùng
  } catch (error) {
    console.log(error);
  }
};

export const getRecurrenceRule = (frequency) => {
  let rule = `RRULE:FREQ=${frequency.toUpperCase()};INTERVAL=1`;
  return rule;
};

export const formatDateOnly = (datetime) => {
  const m = moment(datetime);

  // Nếu giờ và phút đều là 0 thì chỉ trả ngày
  if (m.hour() === 0 && m.minute() === 0) {
    return m.format("YYYY-MM-DD");
  }

  // Nếu có giờ hoặc phút thì trả cả ngày và giờ
  return m.format("YYYY-MM-DD HH:mm");
};

export const  isOnlyOneInstanceUpdated = (masterEvent, instanceEvent) => {
  const isTitleDifferent = masterEvent.title === instanceEvent.summary;
  const isDescDifferent = (masterEvent?.description || "") === (instanceEvent?.description || "");
  const isStartDifferent = new Date(masterEvent.start_time).getTime() === new Date(instanceEvent.start.dateTime).getTime();
  const isEndDifferent = new Date(masterEvent.end_time).getTime() === new Date(instanceEvent.end.dateTime).getTime();


  return isTitleDifferent && isDescDifferent && isStartDifferent && isEndDifferent;
}