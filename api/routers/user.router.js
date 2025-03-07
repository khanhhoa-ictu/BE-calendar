import express from "express";
import {
  forgotPassword,
  login,
  profile,
  refreshToken,
  register,
  requestForgotPassword,
  verifyForgotPassword,
} from "../controllers/user.controller.js";


const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/refreshToken", refreshToken);
router.get("/user/profile", profile);
router.post("/forgot/request", requestForgotPassword);
router.post("/forgot/verify", verifyForgotPassword);
router.post("/forgot/password", forgotPassword);
export default router;
