

import express from "express";
import { checkSyncCalendar, googleCallback, loginGoogle, refreshTokenGoogle, registerWebhook, syncCalendar, webhookGoogle } from "../controllers/google.controller.js";


const router = express.Router();

router.get("/google/auth/:userId", loginGoogle);
router.post("/google/callback", googleCallback);
router.post("/google/sync-calendar", syncCalendar);
router.get("/google/sync-calendar/check/:user_id", checkSyncCalendar);
router.get("/google/auth/refresh-token/:userId", refreshTokenGoogle);
router.post("/google/register-webhook", registerWebhook);
router.post("/webhook", webhookGoogle);





export default router;
