import express from "express";
import {
  addUser,
  deleteUser,
  detailUser,
  getListUser,
  updateUser
} from "../controllers/manager.controller.js";


const router = express.Router();

router.get("/manager/user", getListUser);
router.delete("/manager/delete-user/:id", deleteUser);
router.post("/manager/add-user", addUser);
router.get("/manager/detail-user/:id", detailUser);
router.put("/manager/update-user", updateUser);



export default router;