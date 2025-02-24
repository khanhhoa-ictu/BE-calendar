import express from "express";
import {
  deleteUser,
  getListUser
} from "../controllers/manager.controller.js";


const router = express.Router();

router.get("/manager/user", getListUser);
router.delete("/manager/user/:id", deleteUser);
export default router;