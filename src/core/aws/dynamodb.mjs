import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);


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

    async create(params) {
        try {
            return await docClient.send(new PutCommand(params));
        } catch (error) {
            console.error("DynamoDB Create Error:", error);
            throw error;
        }
    }
    async update(params) {
        return await docClient.send(new UpdateCommand(params))
    }
    async delete(params) {
        return await docClient.send(new DeleteCommand(params))
    }
    async get(params) {
        return await docClient.send(new GetCommand(params))
    }
    async query(params) {
        return await docClient.send(new QueryCommand(params))
    }
    async scan(params) {
        return await docClient.send(new ScanCommand(params))
    }
}

/**
 * @type {Dynamodb}
 * @description The Singleton instance of the DynamoDB client wrapper.
 */
export const db = Dynamodb.getInstance()