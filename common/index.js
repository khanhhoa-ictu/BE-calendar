import moment from "moment";

export const role = {
  USER: '1',
  ADMIN: '2',
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

export const convertTime = (dateTime) => {
  const hour = moment(dateTime).hour(); 
  const minute = moment(dateTime).minute(); 
  return { hour, minute };
};
