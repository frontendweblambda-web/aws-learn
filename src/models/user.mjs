import { db } from "../core/aws/dynamodb.mjs";

const TableName = "Users";




export const User = {
    async create(params) {
        const userId = V4();
        const Date = Date.now();
        const Item = {
            PK: "USER#",
            SK: "POST#",
            ...params,
            userId,
            createdAt: Date,
            updatedAt: Date
        }
        return await db.create({
            TableName,

        })
