

import express from "express";
import {addEvent, deleteEvent, deleteRecurringEvent, getDetailRecurringEvent, listEventByUser, updateEvent, updateRecurringEvent} from "./../controllers/event.controller.js"


const router = express.Router();

router.post("/event/add-event", addEvent);
router.get("/event/:user_id", listEventByUser);
router.put("/event/update-event", updateEvent);
router.delete("/event/delete-event/:id/:accessToken", deleteEvent);
router.get("/recurring-events/:id", getDetailRecurringEvent);
router.delete("/recurring-events/:id/:accessToken", deleteRecurringEvent);
router.put("/recurring-events/:id", updateRecurringEvent);
export default router;
