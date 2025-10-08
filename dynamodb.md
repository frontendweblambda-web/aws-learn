# What is dynamodb?

Dynamodb is a fully managed NoSQL database provided by AWS.

- Document (tables)
- Items (rows)
- Attributes(column field)

**List tables**

```cmd
aws dynamodb list-tables
```

**Create table**

- `Simple with partition key:`

```cmd
aws dynamodb create-table --table-name User --attribute-definitions AttributeName=postId,AttributeType=S --key-schema AttributeName=postId,KeyType=HASH --billing-mode PAY_PER_REQUEST --table-class STANDARD
```

- `Simple with partition key and sort key (coposite key):`

```cmd
aws dynamodb create-table --table-name User --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=Name, AttributeType=S --key-schema AttributeName=postId,KeyType=HASH AttributeName=Name,KeyType=RANGE --billing-mode PAY_PER_REQUEST --table-class STANDARD
```

- `Create table with Tags:`

```cmd
aws dynamodb create-table --table-name User --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=Name, AttributeType=S --key-schema AttributeName=postId,KeyType=HASH AttributeName=Name,KeyType=RANGE
--provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 --tags Key=Owner,Value=pradeep
--billing-mode PAY_PER_REQUEST --table-class STANDARD
```

- `To create a table in On-Demand Mode:`

creates a table called MusicCollection using on-demand mode,
rather than provisioned throughput mode. This is useful for tables with unpredictable
workloads.

```cmd
aws dynamodb create-table --table-name User --attribute-definitions AttributeName=postId,AttributeType=S AttributeName=Name, AttributeType=S --key-schema AttributeName=postId,KeyType=HASH AttributeName=Name,KeyType=RANGE
--provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 --tags Key=Owner,Value=pradeep
--billing-mode PAY_PER_REQUEST --table-class STANDARD
```

`Describe table:`

```cmd
aws dynamodb describe-table --table-name sa_users
<!-- OR -->
aws dynamodb describe-table --table-name sa_users  | findstr TableStatus
```

**`Point-in-time-backups for Dynamodb`**

It's considered best practice to enable Point-in-time backups for
DynamoDB on the table by running the following command

```cmd
aws dynamodb update-continuous-backups --table-name Music --point-in-time-recovery-specification  PointInTimeRecoveryEnabled=true
```

There are cost implications to enabling continuous backups with point-in-time recovery.
