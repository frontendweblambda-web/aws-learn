import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
export const docClient = DynamoDBDocumentClient.from(client);
const TableName = "SocialApp";

class Dynamodb {
    static #instance;
    constructor() {
        console.log("Dynamodb initialized")
    }
    static getInstance() {
        if (!Dynamodb.#instance) {
            Dynamodb.#instance = new Dynamodb()
        }
        console.log("I am singleton")
        return Dynamodb.#instance;
    }

    async listTables() {
        try {
            const comm = new ListTablesCommand({
                Limit: 5
            });
            const tables = (await docClient.send(comm)).TableNames
            console.log("Tables:", tables)
            return tables;
        }
        catch (error) {
            console.log("Error", error);
            throw error
        }
    }
    async create(params) {
        try {
            return await docClient.send(new PutCommand({
                TableName,
                ...params
            }));
        } catch (error) {
            console.error("DynamoDB Create Error:", error);
            throw error;
        }
    }
    async update(params) {
        return await docClient.send(new UpdateCommand({
            TableName,
            ...params
        }))
    }
    async delete(params) {
        return await docClient.send(new DeleteCommand({
            TableName,
            ...params
        }))
    }
    async get(params) {
        return await docClient.send(new GetCommand({
            TableName,
            ...params
        }))
    }
    async query(params) {
        const KeyConditionExpression = params.KeyConditionExpression || "PK = :pk";
        const ExpressionAttributeValues = params.ExpressionAttributeValues || { ":pk": "" };
        const parameters = {
            TableName,
            KeyConditionExpression,
            ExpressionAttributeValues,
            ...params, // allows FilterExpression, ProjectionExpression, IndexName, Limit, etc.
        };
        const result = await docClient.send(new QueryCommand(parameters));
        return result.Items[0]; // contains Items, Count, ScannedCount, etc.
    }
    async scan({ limit = 20, startKey = undefined, ...rest }) {
        const data = await docClient.send(new ScanCommand({
            TableName,
            Limit: limit,
            ExclusiveStartKey: startKey,
            ...rest
        }))

        return {
            items: data.Items,
            nextKey: data.LastEvaluatedKey
        }
    }
}

/**
 * @type {Dynamodb}
 * @description The Singleton instance of the DynamoDB client wrapper.
 */
export const db = Dynamodb.getInstance()