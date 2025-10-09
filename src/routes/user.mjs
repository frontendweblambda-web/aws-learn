import { Router } from "express";
import { body, param } from "express-validator";
import {
    createUser,
    deleteUser,
    getUser,
    getUsers,
    updateUser
} from "../controller/user.mjs";

const route = Router();

route
    // GET all users
    .get("/", getUsers)

    // GET a single user
    .get(
        "/:userId",
        [param("userId").notEmpty().withMessage("UserId is required!")],
        getUser
    )

    // CREATE a new user
    .post(
        "/",
        [
            body("name").notEmpty().withMessage("Name is required!"),
            body("email")
                .notEmpty().withMessage("Email is required!")
                .isEmail().withMessage("Invalid email"),
            body("password")
                .notEmpty().withMessage("Password is required!")
                .isAlphanumeric().withMessage("Password must be alphanumeric"),
            body("mobile")
                .notEmpty().withMessage("Mobile is required!")
                .isMobilePhone().withMessage("Invalid mobile number")
        ],
        createUser
    )

    // UPDATE an existing user
    .put(
        "/:userId",
        [param("userId").notEmpty().withMessage("UserId is required!")],
        updateUser
    )

    // DELETE a user
    .delete(
        "/:userId",
        [param("userId").notEmpty().withMessage("UserId is required!")],
        deleteUser
    );

export { route as userRoute };

