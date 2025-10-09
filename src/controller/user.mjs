import { User } from "../models/user.mjs";

export const getUser = async (req, res, next) => {
    try {
        const userId = req.params.userId;
        console.log("U", req.params)
        const user = await User.getUser(userId);
        user.password = "****"
        res.status(200).json({
            data: user,
            message: "Fetch user",
            success: true
        })
    }
    catch (error) {
        next(error)
    }
}
export const getUsers = async (req, res, next) => {
    try {
        const user = await User.getUsers();
        res.status(200).json({
            data: user,
            message: "Fetch user",
            success: true
        })
    }
    catch (error) {
        next(error)
    }
}
export const createUser = async (req, res, next) => {
    try {

        const user = await User.create(req.body)
        res.status(200).json({
            data: user,
            message: "User created",
            success: true
        })
    }
    catch (error) {
        next(error)
    }
}
export const updateUser = (req, res, next) => {
    try { }
    catch (error) {
        next(error)
    }
}
export const deleteUser = (req, res, next) => {
    try { }
    catch (error) {
        next(error)
    }
}


export const loginUser = (req, res, next) => {
    try { }
    catch (error) {
        next(error)
    }
}
