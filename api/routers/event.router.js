

import express from "express";
import {addEvent, deleteEvent, listEventByUser, updateEvent} from "./../controllers/event.controller.js"


const router = express.Router();

router.post("/event/add-event", addEvent);
router.get("/event/:user_id", listEventByUser);
router.put("/event/update-event", updateEvent);
router.delete("/event/delete-event/:id", deleteEvent);


export default router;
