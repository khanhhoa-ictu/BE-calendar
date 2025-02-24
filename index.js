import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import mysql from "mysql2";
import userManager from "./api/routers/manager.router.js";
import userRouter from "./api/routers/user.router.js";

const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(
  bodyParser.urlencoded({
    limit: "50mb",
    extended: true,
    parameterLimit: 50000,
  })
);

export const db = mysql.createConnection({
  user: "root",
  host: "localhost",
  password: "123456",
  database: "calendar",
});

app.use(userRouter);
app.use(userManager);

app.listen(8080, () => {
  console.log("run");
});
