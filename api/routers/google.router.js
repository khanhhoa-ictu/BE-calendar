

import express from "express";
import { checkSyncCalendar, googleCallback, loginGoogle, syncCalendar } from "../controllers/google.controller.js";


const router = express.Router();

router.get("/google/auth", loginGoogle);
router.post("/google/callback", googleCallback);
router.post("/google/sync-calendar", syncCalendar);
router.get("/google/sync-calendar/check/:user_id", checkSyncCalendar);


export default router;
