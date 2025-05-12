import express from "express";
import {
  addEvent,
  createPoll,
  deleteEvent,
  deleteRecurringEvent,
  finalizePoll,
  getDetailRecurringEvent,
  listEventByUser,
  listPollEvents,
  pollDetail,
  respondToEvent,
  respondToEventRecurring,
  updateEvent,
  updatePoll,
  updateRecurringEvent,
  // updateRecurringFromCurrentEvent,
  vote,
} from "./../controllers/event.controller.js";

const router = express.Router();

router.post("/event/add-event", addEvent);
router.get("/event/:user_id", listEventByUser);
router.put("/event/update-event", updateEvent);
router.delete("/event/delete-event/:id/:accessToken", deleteEvent);
router.get("/recurring-events/:id", getDetailRecurringEvent);
router.delete("/recurring-events/:id/:accessToken", deleteRecurringEvent);
router.put("/recurring-events/:id", updateRecurringEvent);
router.post("/event/respond", respondToEvent)
router.post("/event/respond/recurring", respondToEventRecurring)


//meeting
// router.get("/meeting-poll/:pollId", listPollEvents);
router.post("/meeting-poll/create", createPoll);
router.get("/meeting-poll/:pollId", pollDetail);
router.post("/meeting-poll/finalize", finalizePoll);
router.post("/meeting-poll/:pollId/vote", vote);
router.post("/meeting-poll/update", updatePoll);





export default router;
