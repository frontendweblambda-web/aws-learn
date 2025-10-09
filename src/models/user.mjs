import { v4 } from "uuid";
import { db } from "../core/aws/dynamodb.mjs";
import { Password } from '../utils/password.mjs';

export const User = {
    async create(params) {
        console.log("Params", params)
        const { name, email, mobile, password } = params
        const userId = v4();
        const now = new Date().toISOString();
        const hashPassword = await Password.hash(password)
        const Item = {
            PK: `USER#${userId}`,
            SK: `PROFILE#${userId}`,
            entityType: "USER",
            name,
            email,
            userId,
            mobile,
            password: hashPassword,
            active: true,
            avatar: null,
            createdAt: now,
            updatedAt: now,
        }
        return await db.create({ Item, ConditionExpression: "attribute_not_exists(PK)" })

    },
    async getUser(userId) {
        return await db.query({ ExpressionAttributeValues: { ":pk": userId } })
    },
    async getUsers(params = {}) {
        return await db.scan(params)
    },
    async update() { },
    async getByEmail() { },
    async getByMobile() { },
    async deleteUser() { }
}