import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "khanhhoatest@gmail.com",
    pass: "bqjd xjcw ijeb ijld",
  },
  tls: {
    // do not fail on invalid certs
    rejectUnauthorized: false,
  },
});

export const sendEmailForgotPassword = async (email, token) => {
  let mailOptions = {
    from: '"Smile 👻" <khanhhoatest@gmail.com>', // sender address
    to: email, // list of receivers
    subject: "Forgot password Verification Token", // Subject line
    html:
      "<b>Forgot password</b>" +
      " <br/>" +
      "<span>Please enter OTP below</span>" +
      "<br/>" +
      "<span>" +
      token +
      "</span>",
  };
  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.log(err);
    return false;
  }
  return true;
};
