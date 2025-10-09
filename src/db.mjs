import { CreateTableCommand, } from "@aws-sdk/client-dynamodb";
import { docClient } from "./core/aws/dynamodb.mjs";

const params = {
    TableName: "User",
    AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },  // Partition Key
        { AttributeName: "SK", AttributeType: "S" },  // Sort Key
    ],
    KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },  // Partition Key
        { AttributeName: "SK", KeyType: "RANGE" }, // Sort Key
    ],
    // BillingMode: "PAY_PER_REQUEST",  
    ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
    }
};


async function createTable() {
    try {
        const command = new CreateTableCommand({
            ...params,
        });
        // const command = new DescribeTableCommand({ TableName: 'SocialApp' })
        const response = await docClient.send(command);
        console.log("Table created successfully:", response);
    } catch (err) {
        console.log("E", err)
        if (err.name === "ResourceInUseException") {
            console.log("Tale already existed")
        }
        console.error("Error creating table:", err);
    }
}


createTable()