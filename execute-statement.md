Below is a **deep‑dive** into **`ExecuteStatement` (PartiQL) in DynamoDB**, covering:

- CLI usage (all related flags, pagination, error cases)
- SDK usage in **Node.js (v3)**
- Edge cases, pitfalls, and interview-style questions
- Comparison with batch/transaction alternatives

I'll go step‑by‑step and try not to skip. If you prefer a shorter “cheatsheet” version, I can produce that afterward.

---

## 1. Overview & Key Concepts

Before diving into commands and code, let's recap what `ExecuteStatement` does and its constraints.

- `ExecuteStatement` executes a **single PartiQL statement** (SQL-like syntax) against a DynamoDB table.
- Supported statements: `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- It can do _singleton writes_ (single insert/update/delete). For multiple statements, you’d use `BatchExecuteStatement` or transactions.
- For `SELECT`, results are paginated if the result set is large (1 MB of data processed) or you specify a `Limit`.
- You can supply **parameterized statements**: use `?` as placeholders, and then supply `Parameters` list matching them.
- You can pass read consistency (`ConsistentRead`), paging via `NextToken`, limit, etc.
- When a write fails a condition (for conditional updates/deletes), you can request return of the old item (`ReturnValuesOnConditionCheckFailure`).
- Performance: there is overhead for parsing/evaluating the PartiQL statement. For high throughput or bulk operations, native DynamoDB APIs (PutItem, UpdateItem, Query, etc.) may be more efficient.
- Limitations: no joins, limited aggregations (only `COUNT(*)`), etc.

The AWS CLI reference for `execute-statement` shows all its parameters and options. ([AWS Documentation][1])

Also, for SDKs, AWS provides example usage in their docs. ([AWS Documentation][2])

With that in mind, let’s systematically go through **CLI** and **SDK** usage.

---

## 2. AWS CLI: `aws dynamodb execute-statement`

### CLI Syntax & Options

From AWS CLI docs:

```
aws dynamodb execute-statement
  --statement <string>
  [--parameters <value>]
  [--consistent-read | --no-consistent-read]
  [--next-token <value>]
  [--limit <value>]
  [--return-values-on-condition-check-failure <value>]
  [--return-consumed-capacity <value>]
  [--cli-input-json <string>]
  [--generate-cli-skeleton <string>]
  [--debug]
  [--endpoint-url <value>]
  [--no-verify-ssl]
  [--no-paginate]
  [--output <value>]
  [--query <value>]
  [--profile <value>]
  [--region <value>]
```

Key flags you need to know:

- `--statement`: the PartiQL string
- `--parameters`: JSON list of attribute value objects
- `--consistent-read`: to force strong consistency for reads
- `--next-token`: for paging
- `--limit`: to cap number of processed items
- `--return-values-on-condition-check-failure`: for writes with condition
- `--cli-input-json`: alternative to inline flags
- `--generate-cli-skeleton`: to generate JSON skeleton template ([AWS Documentation][1])

Let’s go through each scenario, with examples and pitfalls.

---

### 2.1 SELECT (Read) Examples

Assume a table:

- Table Name: `Users`
- Primary Key: `userId` (String)
- Other attribute: `active` (Boolean), `name` (String), etc.

#### Basic SELECT all

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users"
```

This will scan the table (since no `WHERE` clause). For large tables, you may only get a subset and a `NextToken`.

Output includes:

- `Items` (list of attribute maps)
- `NextToken` (if there are more pages)
- `ConsumedCapacity` (if requested)
- `LastEvaluatedKey` is returned in native format, although CLI uses `NextToken` for paging.

#### SELECT with WHERE and parameters

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users WHERE active = ?" \
  --parameters '[{"BOOL": true}]'
```

Explanation:

- The `?` placeholder corresponds to the first (and only) parameter.
- We pass `{"BOOL": true}` to match `active = true`.

Be careful with quoting/escaping in your shell. Using single quotes around the JSON and escaping inner quotes is typical.

#### SELECT with projection, limit, and consistent read

```bash
aws dynamodb execute-statement \
  --statement "SELECT userId, name FROM Users WHERE active = ? LIMIT 10" \
  --parameters '[{"BOOL": true}]' \
  --limit 10 \
  --consistent-read
```

Notes:

- `LIMIT 10` in the statement tells DynamoDB to stop after evaluating 10 items (or earlier).
- `--limit 10` is also a CLI-level limit on the processed items (not necessarily number of matching items) ([AWS Documentation][1])
- `--consistent-read` enforces **strong consistency** on reads (if supported).

#### Pagination (NextToken)

If your first call returns `NextToken`, you can fetch the next page:

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users WHERE active = ?" \
  --parameters '[{"BOOL": true}]' \
  --next-token "eyJ..."   # the NextToken value from previous result
```

You can loop until there is no `NextToken` in the response.

Pitfall: if you also set `--no-paginate`, the CLI will only fetch the first page and not automatically follow NextToken. ([AWS Documentation][1])

#### Interview-style questions on SELECT & CLI

1. **Q:** What is the difference between `--limit` in the statement vs `LIMIT` inside the PARTIQL statement?
   **A:** The `LIMIT` inside the statement bounds how many items the statement will return (or how many to evaluate). The CLI `--limit` constrains how many items the command is allowed to _process_, regardless of matches.

2. **Q:** Why might a `SELECT` operation return fewer items than you expect even though there are more matching items?
   **A:** Because DynamoDB limits processing of items to 1 MB of data (unfiltered) per operation. If the processed dataset crosses 1 MB before finishing, it returns partial results plus a `NextToken` for continuation.

3. **Q:** Can you do a JOIN across two tables using `ExecuteStatement`?
   **A:** No. DynamoDB’s PartiQL in `ExecuteStatement` does not support joins.

---

### 2.2 INSERT (Write) Examples

Inserts are singleton (single item). If an item with the same key exists, the insert will fail (unless overwritten via UPSERT semantics—though PartiQL `INSERT` is strict).

Assume same `Users` table with `userId` primary key and optional sort key `email`.

#### Simple insert

```bash
aws dynamodb execute-statement \
  --statement "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?}" \
  --parameters '[{"S": "u123"}, {"S": "Alice"}, {"BOOL": true}]'
```

- The JSON object syntax `{'userId': ?, ...}` is the PartiQL `VALUE` clause.
- The `Parameters` list must match placeholders in order.

#### Insert with conditional check

You might want to only insert if the item doesn't exist:

```bash
aws dynamodb execute-statement \
  --statement "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?} IF attribute_not_exists(userId)" \
  --parameters '[{"S": "u123"}, {"S": "Alice"}, {"BOOL": true}]'
```

If the condition fails, the write will be rejected. You can use `--return-values-on-condition-check-failure` to request return of existing attributes (the old item). For example:

```bash
aws dynamodb execute-statement \
  --statement "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?} IF attribute_not_exists(userId)" \
  --parameters '[{"S": "u123"}, {"S": "Alice"}, {"BOOL": true}]' \
  --return-values-on-condition-check-failure ALL_OLD
```

If the insert fails due to the condition, it will return the existing item under `"Attributes"` or similar.

#### Interview-style questions on INSERT & CLI

1. **Q:** What happens if you try to insert an item with the same key via `ExecuteStatement`?
   **A:** It will error (“ConditionalCheckFailedException” or similar) unless you used some overwrite semantics—but by default, `INSERT` is insert-only.

2. **Q:** Can you insert multiple items in one `ExecuteStatement` call?
   **A:** No — `ExecuteStatement` handles only one statement. To batch multiple inserts, use `BatchExecuteStatement` (which accepts a list of statements).

---

### 2.3 UPDATE (Write) Examples

You can update individual attributes of an item (identified by key). PartiQL `UPDATE` is expressive: you can `SET`, `REMOVE`, etc.

Assume `Users` table with `userId` as PK.

#### Basic update

```bash
aws dynamodb execute-statement \
  --statement "UPDATE Users SET active = ?, name = ? WHERE userId = ?" \
  --parameters '[{"BOOL": false}, {"S": "Bob"}, {"S": "u123"}]'
```

This sets `active = false` and `name = "Bob"` for `userId = "u123"`.

If your table has a sort key, you must include both in the `WHERE` clause.

#### Conditional update

You may only want to update if some existing condition holds:

```bash
aws dynamodb execute-statement \
  --statement "UPDATE Users SET active = ? WHERE userId = ? IF active = ?" \
  --parameters '[{"BOOL": false}, {"S": "u123"}, {"BOOL": true}]' \
  --return-values-on-condition-check-failure ALL_OLD
```

If `active` was already false (i.e. condition fails), the update fails and returns the old state.

#### Return attributes on update

PartiQL `UPDATE` does not directly support returning updated attributes in the same call like SQL’s `RETURNING` clause. But you can do a follow-up `SELECT` if needed. Some SDKs may provide easier patterns.

#### Interview-style questions on UPDATE & CLI

1. **Q:** How do you perform a conditional update using `ExecuteStatement`?
   **A:** Append an `IF <condition>` clause to the SQL, and optionally use `--return-values-on-condition-check-failure`.

2. **Q:** If an `UPDATE` fails a condition, what is returned?
   **A:** The response will contain **no Items** (no updated result) and if `--return-values-on-condition-check-failure` is set, the previous item (or part of it) may be returned.

---

### 2.4 DELETE (Write) Examples

Delete removes an item by key.

#### Basic delete

```bash
aws dynamodb execute-statement \
  --statement "DELETE FROM Users WHERE userId = ?" \
  --parameters '[{"S": "u123"}]'
```

If there is a sort key, include it:

```bash
aws dynamodb execute-statement \
  --statement "DELETE FROM Users WHERE userId = ? AND email = ?" \
  --parameters '[{"S": "u123"}, {"S": "u123@example.com"}]'
```

#### Conditional delete

You might want to delete only if certain condition holds:

```bash
aws dynamodb execute-statement \
  --statement "DELETE FROM Users WHERE userId = ? IF active = ?" \
  --parameters '[{"S": "u123"}, {"BOOL": false}]' \
  --return-values-on-condition-check-failure ALL_OLD
```

If the condition fails (e.g. `active` was true), the delete is rejected and the old item returned (if requested).

#### Interview-style questions on DELETE & CLI

1. **Q:** Can `DELETE` in PartiQL delete multiple items matching a condition (e.g. `WHERE active = false`)?
   **A:** No. It is a singleton delete. You cannot delete multiple rows in one go via `ExecuteStatement`. You’d have to fetch keys first then issue deletes individually or via `BatchExecuteStatement` or transaction.

2. **Q:** If you do `DELETE` without a condition, what happens if the item doesn’t exist?
   **A:** The operation is idempotent; deleting a non-existing item is a no-op (no error).

---

### 2.5 Other CLI Options & Utilities

#### `--consistent-read`

Used only for read (SELECT). Forces a strongly consistent read:

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users WHERE userId = ?" \
  --parameters '[{"S": "u123"}]' \
  --consistent-read
```

#### `--return-consumed-capacity`

You can request capacity metrics:

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users WHERE userId = ?" \
  --parameters '[{"S": "u123"}]' \
  --return-consumed-capacity TOTAL
```

Response will include `ConsumedCapacity` details with read/write units used.

#### `--cli-input-json`

Instead of inline flags, you can supply all parameters through a JSON file:

Create `input.json`:

```json
{
  "Statement": "SELECT * FROM Users WHERE active = ?",
  "Parameters": [{ "BOOL": true }],
  "Limit": 5,
  "ConsistentRead": true
}
```

Then:

```bash
aws dynamodb execute-statement --cli-input-json file://input.json
```

This is often easier to manage for complex calls. ([AWS Documentation][1])

#### `--generate-cli-skeleton`

You can run:

```bash
aws dynamodb execute-statement --generate-cli-skeleton input
```

It will output a JSON skeleton template you can fill. Useful for building `--cli-input-json` inputs.

#### `--no-paginate`

By default, the AWS CLI may automatically follow NextTokens to fetch all pages. If you want **only the first page**, use:

```bash
--no-paginate
```

This causes CLI to issue a single call and not repeat to fetch next pages. ([AWS Documentation][1])

#### `--debug`

Useful for debugging parameter parsing, HTTP request/response details, etc:

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM Users" \
  --debug
```

---

## 3. Node.js (SDK v3) Usage of `ExecuteStatement`

Now let’s look at how to use `ExecuteStatement` in Node.js using AWS SDK v3, including Document client (lib-dynamodb) and base client.

### 3.1 AWS SDK v3 basics & data marshalling

In SDK v3, you use a **client + command** pattern:

```js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ExecuteStatementCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const cmd = new ExecuteStatementCommand({
  Statement: "SELECT * FROM Users WHERE userId = ?",
  Parameters: [{ S: "u123" }],
});
const resp = await client.send(cmd);
console.log(resp.Items);
```

The `Parameters` must be in the **DynamoDB JSON (AttributeValue) format** (e.g. `{ S: "…" }`, `{ N: "123" }`, `{ BOOL: true }`, etc.). This is the _low-level_ API. SDK reference shows the type definitions for `ExecuteStatementCommand` including `Parameters` shape. ([UNPKG][3])

#### Using `util-dynamodb` for marshalling / unmarshalling

To ease working with native JavaScript objects, AWS provides utilities:

```js
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
```

Using them:

- For input parameters: `marshall` your JS object into DynamoDB JSON.
- For output items: use `unmarshall` to convert back to plain JS object.

Example:

```js
const {
  DynamoDBClient,
  ExecuteStatementCommand,
} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "us-east-1" });

async function getUser(userId) {
  const cmd = new ExecuteStatementCommand({
    Statement: "SELECT * FROM Users WHERE userId = ?",
    Parameters: [{ S: userId }], // or marshall({ userId }) but for parameters you pass single attr value
  });
  const resp = await client.send(cmd);
  if (resp.Items) {
    return resp.Items.map((item) => unmarshall(item));
  }
  return [];
}
```

Alternatively, you might use the **Document Client (lib-dynamodb)** which abstracts away the marshalling/unmarshalling. But beware: there are known bugs when using `ExecuteStatement` + Document Client with `Parameters` arrays (especially lists) — see below. ([GitHub][4])

### 3.2 Examples by statement type

I'll go through SELECT, INSERT, UPDATE, DELETE, with code.

Assume a table `Users`:

```js
const client = new DynamoDBClient({ region: "us-east-1" });
```

(or use Document Client wrapper, but I'll mostly use base client for clarity.)

#### SELECT example

```js
import { ExecuteStatementCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

async function selectActiveUsers() {
  const stmt = "SELECT * FROM Users WHERE active = ?";
  const params = [{ BOOL: true }];

  const cmd = new ExecuteStatementCommand({
    Statement: stmt,
    Parameters: params,
    ConsistentRead: false, // optional
    Limit: 10, // optional
  });

  const resp = await client.send(cmd);
  const items = (resp.Items || []).map((i) => unmarshall(i));
  const nextToken = resp.NextToken;
  return { items, nextToken, consumedCapacity: resp.ConsumedCapacity };
}
```

If `nextToken` is non-null, you can call again with the same statement and parameters, adding `NextToken: nextToken`.

#### INSERT example

```js
import { ExecuteStatementCommand } from "@aws-sdk/client-dynamodb";

async function insertUser(user) {
  // user: { userId, name, active }
  const stmt = "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?}";
  const params = [{ S: user.userId }, { S: user.name }, { BOOL: user.active }];

  const cmd = new ExecuteStatementCommand({
    Statement: stmt,
    Parameters: params,
  });

  const resp = await client.send(cmd);
  return resp; // usually no Items returned
}
```

If you want a conditional insert:

```js
const cmd = new ExecuteStatementCommand({
  Statement:
    "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?} IF attribute_not_exists(userId)",
  Parameters: [{ S: user.userId }, { S: user.name }, { BOOL: user.active }],
  ReturnValuesOnConditionCheckFailure: "ALL_OLD",
});
```

If the item already exists, the command throws or returns an error with the old item attributes.

#### UPDATE example

```js
async function updateUser(userId, name, isActive) {
  const stmt = "UPDATE Users SET name = ?, active = ? WHERE userId = ?";
  const params = [{ S: name }, { BOOL: isActive }, { S: userId }];

  const cmd = new ExecuteStatementCommand({
    Statement: stmt,
    Parameters: params,
  });

  const resp = await client.send(cmd);
  return resp;
}
```

With condition:

```js
const cmd = new ExecuteStatementCommand({
  Statement: "UPDATE Users SET active = ? WHERE userId = ? IF active = ?",
  Parameters: [{ BOOL: false }, { S: userId }, { BOOL: true }],
  ReturnValuesOnConditionCheckFailure: "ALL_OLD",
});
```

#### DELETE example

```js
async function deleteUser(userId) {
  const stmt = "DELETE FROM Users WHERE userId = ?";
  const params = [{ S: userId }];

  const cmd = new ExecuteStatementCommand({
    Statement: stmt,
    Parameters: params,
  });

  const resp = await client.send(cmd);
  return resp;
}
```

With condition:

```js
const cmd = new ExecuteStatementCommand({
  Statement: "DELETE FROM Users WHERE userId = ? IF active = ?",
  Parameters: [{ S: userId }, { BOOL: false }],
  ReturnValuesOnConditionCheckFailure: "ALL_OLD",
});
```

### 3.3 Using Document Client (lib-dynamodb) and caveats

To make life easier, AWS provides `lib-dynamodb`’s Document client which accepts and returns plain JS objects:

```js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ExecuteStatementCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);
```

Then:

```js
const cmd = new ExecuteStatementCommand({
  Statement: "SELECT * FROM Users WHERE active = ?",
  Parameters: [true], // Document client allows native JS types
});
const resp = await docClient.send(cmd);
console.log(resp.Items); // already unmarshalled
```

However, **warning**: There have been known bugs when using `ExecuteStatementCommand` (via `lib-dynamodb`) when `Parameters` include **lists** (`L`) or nested structures, causing errors such as `Cannot read properties of undefined (reading '0')`. ([GitHub][4])

Because of this, for more complex statements, using the base `@aws-sdk/client-dynamodb` (and manual marshalling) tends to be more reliable.

### 3.4 Pagination (NextToken)

In SDK usage, when you get a response with `NextToken`, you pass it into the next call:

```js
const resp1 = await client.send(cmd);
const nextToken = resp1.NextToken;
if (nextToken) {
  const resp2 = await client.send(
    new ExecuteStatementCommand({
      Statement: stmt,
      Parameters: params,
      NextToken: nextToken,
    })
  );
  // process resp2.Items
}
```

You may loop until `NextToken` is null.

### 3.5 Error Handling & Edge Cases

- **Conditional check fails**: error thrown. Use try/catch and inspect error name (e.g. `ConditionalCheckFailedException`).
- **Type mismatch**: If parameter types don’t match (e.g. passing string for a number), you'll get `ValidationException`.
- **Using Document Client with complex parameters**: as noted, might error in some cases.
- **Large result sets**: use pagination.
- **Throughput & capacity**: large SELECTs consume read capacity; use projections or filters to limit.
- **Binary / Blob types**: For `B` / `BS`, you must supply a `Uint8Array` or base64 buffer.

### 3.6 Interview-style questions on SDK usage

1. **Q:** What is the difference between `@aws-sdk/client-dynamodb` vs `@aws-sdk/lib-dynamodb` (Document Client) for `ExecuteStatement`?
   **A:** The client module works with raw DynamoDB JSON types (`S`, `N`, `BOOL`, etc.), whereas `lib-dynamodb` (Document Client) allows using native JS types (strings, numbers, booleans) and abstracts marshalling/unmarshalling. But it has known bugs when parameters are list types.

2. **Q:** How do you handle pagination in SDK calls with `ExecuteStatement`?
   **A:** Use the `NextToken` returned in the response to feed into next call (setting `NextToken` field in subsequent `ExecuteStatementCommand`). Loop until `NextToken` is null.

3. **Q:** Can you batch multiple statements in SDK v3?
   **A:** Yes, using `BatchExecuteStatementCommand` (similar to CLI `batch-execute-statement`), which accepts a list of statements and executes them.

4. **Q:** Why might you avoid `ExecuteStatement` and use native APIs instead?
   **A:** Because for simple operations (GetItem, PutItem, Query, UpdateItem), native APIs might be more efficient (lower overhead). `ExecuteStatement` has parsing overhead. Also, for bulk operations, you'd use `BatchWriteItem` or transactions.

---

## 4. Batch & Transaction Alternatives

Since `ExecuteStatement` only supports **one** statement at a time, AWS provides:

- **BatchExecuteStatement**: execute multiple PartiQL statements in a single call (non-transactional).
- **ExecuteTransaction** (`execute-transaction` in CLI): execute multiple statements in a transactional context (all succeed or none).

### CLI: `aws dynamodb batch-execute-statement`

```bash
aws dynamodb batch-execute-statement \
  --statements '[
    {
      "Statement": "INSERT INTO Users VALUE {'userId': ?, 'name': ?}",
      "Parameters": [ {"S":"u1"}, {"S":"Alice"} ]
    },
    {
      "Statement": "UPDATE Users SET active = ? WHERE userId = ?",
      "Parameters": [ {"BOOL": false}, {"S":"u2"} ]
    }
  ]'
```

Or via `--cli-input-json`. See CLI reference for details. ([fig.io][5])

### CLI: `aws dynamodb execute-transaction`

```bash
aws dynamodb execute-transaction \
  --transact-statements '[
    {
      "Statement": "UPDATE Users SET active = ? WHERE userId = ?",
      "Parameters": [ {"BOOL": true}, {"S": "u1"} ]
    },
    {
      "Statement": "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?}",
      "Parameters": [ {"S": "u3"}, {"S": "Charlie"}, {"BOOL": true} ]
    }
  ]'
```

All statements execute atomically. ([fig.io][6])

In SDK v3, you have `BatchExecuteStatementCommand` and `ExecuteTransactionCommand` (or `TransactWriteCommand` for native APIs).

---

## 5. Putting It All Together: Sample Project Flow

Here’s how one might structure an application around `ExecuteStatement`:

1. **Setup**: Initialize DynamoDB client (or document client).
2. **Insert** new items as users are created.
3. **Query / SELECT** items via filters or primary key.
4. **Update** records (e.g. toggle `active`) via `UPDATE` statements.
5. **Delete** when needed.
6. Use **pagination** for large SELECTs.
7. Use **batch** or **transaction** when executing multiple operations atomically.
8. Handle errors (conditional failures, throttling, etc.).

---

## 6. Common Pitfalls & Tips

- Always match number of `?` placeholders with `Parameters` count, in same order.
- Watch out for shell quoting issues when running CLI (escape quotes properly).
- In the CLI, passing JSON to `--parameters` often causes parsing errors; using `--cli-input-json` is safer.
- Be mindful of page size and data volume (1 MB limit) for SELECTs.
- The Document client (`lib-dynamodb`) has known bugs around `ExecuteStatement` with lists; for complex operations, use base client.
- Use `--debug` in CLI or inspect `$metadata` in SDK errors to troubleshoot.
- For write-heavy or high throughput scenarios, native APIs or BatchWrite may be more efficient.
- Don’t expect joins or complex SQL features — DynamoDB’s PartiQL is limited.

---

Perfect! Let's now **continue this comprehensive DynamoDB command deep dive**, focusing on:

---

# 🔸 `batch-execute-statement` — Deep Dive (CLI + SDK + Examples)

---

## 📚 What is `batch-execute-statement`?

`batch-execute-statement` allows you to **execute multiple PartiQL statements in a single batch**, up to 25 statements per request. It supports:

- **`SELECT`**
- **`INSERT`**
- **`UPDATE`**
- **`DELETE`**

But unlike `execute-transaction`, it’s **not transactional** — the statements are executed **independently**, and partial success is possible.

---

## ⚙️ CLI Syntax

```bash
aws dynamodb batch-execute-statement \
  --statements '[<StatementRequest>...]'
  [--return-consumed-capacity <value>]
  [--cli-input-json <value>]
  [--generate-cli-skeleton <value>]
```

---

## 📘 StatementRequest Format

Each item in the `--statements` array is a JSON object:

```json
{
  "Statement": "INSERT INTO Users VALUE {'userId': ?, 'name': ?}",
  "Parameters": [{ "S": "u1" }, { "S": "Alice" }]
}
```

---

## 🧪 Example 1: Batch Insert

```bash
aws dynamodb batch-execute-statement \
  --statements '[
    {
      "Statement": "INSERT INTO Users VALUE {\"userId\": ?, \"name\": ?, \"active\": ?}",
      "Parameters": [
        { "S": "u101" },
        { "S": "Alice" },
        { "BOOL": true }
      ]
    },
    {
      "Statement": "INSERT INTO Users VALUE {\"userId\": ?, \"name\": ?, \"active\": ?}",
      "Parameters": [
        { "S": "u102" },
        { "S": "Bob" },
        { "BOOL": false }
      ]
    }
  ]'
```

✔️ Both inserts will be attempted.
❌ If one fails (e.g., condition or duplicate key), it won't block the other.

---

## 🧪 Example 2: Batch Update and Select

```bash
aws dynamodb batch-execute-statement \
  --statements '[
    {
      "Statement": "UPDATE Users SET active = ? WHERE userId = ?",
      "Parameters": [
        { "BOOL": false },
        { "S": "u101" }
      ]
    },
    {
      "Statement": "SELECT * FROM Users WHERE userId = ?",
      "Parameters": [
        { "S": "u102" }
      ]
    }
  ]'
```

👉 Results will contain a `Responses` array with results from each statement in order.

---

## 🧪 Example 3: CLI JSON input

Create `input.json`:

```json
{
  "Statements": [
    {
      "Statement": "DELETE FROM Users WHERE userId = ?",
      "Parameters": [{ "S": "u101" }]
    },
    {
      "Statement": "SELECT * FROM Users WHERE userId = ?",
      "Parameters": [{ "S": "u102" }]
    }
  ]
}
```

Run:

```bash
aws dynamodb batch-execute-statement --cli-input-json file://input.json
```

---

## 📦 SDK v3 (Node.js) Example

### Install packages

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
```

### Code (JS/TS)

```js
import {
  DynamoDBClient,
  BatchExecuteStatementCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

const command = new BatchExecuteStatementCommand({
  Statements: [
    {
      Statement:
        "INSERT INTO Users VALUE {'userId': ?, 'name': ?, 'active': ?}",
      Parameters: [{ S: "u201" }, { S: "Charlie" }, { BOOL: true }],
    },
    {
      Statement: "SELECT * FROM Users WHERE userId = ?",
      Parameters: [{ S: "u202" }],
    },
  ],
});

const response = await client.send(command);
console.log(JSON.stringify(response, null, 2));
```

👉 Output includes:

```json
{
  "Responses": [
    {}, // no result from INSERT
    {
      "Items": [{ "userId": { "S": "u202" }, "name": { "S": "David" } }]
    }
  ]
}
```

---

## ⚠️ Limitations

| Limitation               | Value                                       |
| ------------------------ | ------------------------------------------- |
| Max Statements per batch | 25                                          |
| No atomicity             | ❌ Each statement is executed independently |
| No rollback              | ❌ Partial success possible                 |
| Max payload size         | 1 MB                                        |
| No joins or aggregates   | ❌ As with all PartiQL in DynamoDB          |

---

## 💡 Interview Questions: `batch-execute-statement`

### Q1: How is `batch-execute-statement` different from `execute-transaction`?

**A:** `batch-execute-statement` executes multiple PartiQL statements **non-transactionally** (i.e., partial success allowed), while `execute-transaction` is **atomic** — all succeed or none.

---

### Q2: Can `batch-execute-statement` perform multiple `SELECT` queries?

**A:** Yes. You can include any mix of `SELECT`, `INSERT`, `UPDATE`, or `DELETE` statements (up to 25 total).

---

### Q3: If one statement fails, do others still execute?

**A:** Yes. Other statements in the batch are still executed — the failed one will return an error in its response object.

---

### Q4: How do you ensure conditional inserts in batch?

**A:** Use the `IF attribute_not_exists(...)` clause in each `INSERT` statement. If the condition fails, that statement fails, but others proceed.

---

## ✅ Summary: `batch-execute-statement`

| Feature                | Supported?                                |
| ---------------------- | ----------------------------------------- |
| Multiple statements    | ✅ (up to 25)                             |
| Transactional (atomic) | ❌ No                                     |
| Supported operations   | ✅ `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| PartiQL supported?     | ✅ Yes                                    |
| Condition expressions  | ✅ Yes (in statement)                     |
| SDK v3 Support         | ✅ Yes (`BatchExecuteStatementCommand`)   |

---

Would you like to move on to:

🔹 **`execute-transaction`**
or
🔹 **`transact-write-items` / `transact-get-items`**
or another?

Let me know — I’ll continue the deep dive step-by-step.
Great — that’s a smart approach.

Instead of going through **all 60+ DynamoDB commands**, you want to **deep dive only into the ones that are used most often in real-world use**, especially:

- 👨‍💻 CLI & SDK usage
- ✅ Common patterns (CRUD, queries, transactions)
- ⚠️ Edge cases
- 💬 Interview questions

---

## ✅ Shortlisted DynamoDB Commands (Most Commonly Used)

I'll cover each of these in full depth — one by one — with examples and best practices:

---

### 🔹 1. `execute-statement`

> Perform a **single PartiQL query** (INSERT, SELECT, UPDATE, DELETE).

- ✅ Useful for SQL-like syntax.
- CLI + SDK already started above — will do more examples (with nested data, types, etc.)

---

### 🔹 2. `batch-execute-statement`

> Run multiple PartiQL statements **in one call** (non-transactional).

- Great for **bulk inserts/updates** with less overhead.

✅ Already covered in previous message — but we can expand on advanced use cases (e.g., conditional expressions).

---

### 🔹 3. `execute-transaction`

> Run multiple PartiQL statements **atomically**.

- All succeed or none.
- Supports **up to 25** statements.
- Perfect for banking, shopping carts, etc.

---

### 🔹 4. `transact-write-items`

> Non-PartiQL version of atomic write transactions (Put, Update, Delete, ConditionCheck).

- More **powerful** and lower-level than PartiQL.
- Supports **conditional expressions** on any item.
- Used heavily in fintech, critical systems.

---

### 🔹 5. `transact-get-items`

> Atomic retrieval of up to 25 items.

- Ensures **consistent reads** across multiple keys.
- Often paired with `transact-write-items`.

---

### 🔹 6. `query`

> Query a table or index based on the **partition key**, optionally with a sort key.

- Most **efficient read** operation.
- Supports filters, pagination, sorting.

---

### 🔹 7. `scan`

> Read **all items** in a table or index.

- Can be **costly** — avoid when possible.
- Use filters + limit + projection to optimize.

---

### 🔹 8. `put-item`, `get-item`, `update-item`, `delete-item`

> Basic CRUD operations.

- Often used via SDK (Node.js / Python).
- Supports **condition expressions**.

---

### 🔹 9. `batch-write-item`, `batch-get-item`

> Batch CRUD for up to 25 items (non-transactional).

- More efficient than calling `put-item` or `get-item` in loops.

---

## ✳️ Optional Advanced Commands (covered only if needed later)

| Command                                | Description                  |
| -------------------------------------- | ---------------------------- |
| `create-table` / `delete-table`        | Table management             |
| `describe-table`                       | Schema & throughput info     |
| `update-table`                         | Change read/write capacity   |
| `restore-table-from-backup`            | Backup recovery              |
| `list-tables`, `list-tags-of-resource` | Utility commands             |
| `tag-resource` / `untag-resource`      | Tagging for billing/security |

---

## ✅ Let’s Proceed

Since you've already seen `batch-execute-statement`, and started on `execute-statement` — next logical command to cover is:

> ✅ **`execute-transaction`** (atomic PartiQL transactions)

Would you like to:

- ➕ Continue with `execute-transaction` deep dive now?
- Or jump to another like `transact-write-items` or `query`?

Let me know and I’ll give you the next section in full detail.
Below is a **deep dive** into DynamoDB transactions — from basics → advanced, with **CLI + AWS SDK v3 (JavaScript / TypeScript via `@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb`)** code, real‑world scenarios, interview questions, pitfalls, and patterns. I’ll walk step by step, cover all the core parts (and some advanced caveats). If you want a shorter “cheat sheet” or slides, I can generate that too.

---

## Overview: What is a DynamoDB Transaction?

A _transaction_ in DynamoDB allows you to group multiple read or write operations into a single atomic unit: either **all succeed** or **none do**. This gives you ACID guarantees (Atomicity, Consistency, Isolation, Durability) across multiple items (possibly in multiple tables).

Key points:

- You can perform **reads** (via `TransactGetItems`) or **writes** (via `TransactWriteItems` / `ExecuteTransaction`) — but you cannot mix reads and writes in the same transaction. (Though newer PartiQL `ExecuteTransaction` API allows only read _or_ write statements; it doesn’t allow a mix). ([AWS Documentation][1])
- Each transaction is limited to a maximum number of items and total payload size (e.g. 25 items for reads, 100 items for writes in some contexts) and a 4 MB aggregate size limit. ([AWS Documentation][2])
- Under the hood, DynamoDB uses a two-phase commit-like mechanism: first “prepare” then “commit.” That means each item involved is read or written twice (so your capacity units usage needs to account for that). ([AWS Documentation][3])
- Transactions are isolated: partial updates are not visible to other operations until commit.
- You can also include _condition checks_ in the transaction (i.e. ensure something is true before proceeding).
- You can supply a `ClientRequestToken` to make the transaction idempotent (so repeated attempts don’t double apply). ([AWS Documentation][2])
- If any operation inside the transaction fails (for example, a condition check fails, or capacity exceeded, or conflict), then the entire transaction fails (no partial state). ([AWS Documentation][2])
- Because of the underlying two-phase commit, transactions have somewhat higher cost and throughput consumption, and are more susceptible to conflicts / throttling. So you should use them judiciously. ([AWS Documentation][3])

---

## CLI Examples

The AWS CLI supports DynamoDB transactional operations:

### `transact-write-items`

This is the write transaction (for grouping writes) CLI. ([AWS Documentation][2])

**Example:** Suppose you have two tables, `AccountA` and `AccountB`, and you want to move $100 from A to B atomically (debit one, credit the other).

You could create a file `transact-items.json`:

```json
[
  {
    "Update": {
      "TableName": "AccountA",
      "Key": { "AccountId": { "S": "A123" } },
      "UpdateExpression": "SET Balance = Balance - :amt",
      "ExpressionAttributeValues": { ":amt": { "N": "100" } },
      "ConditionExpression": "Balance >= :amt"
    }
  },
  {
    "Update": {
      "TableName": "AccountB",
      "Key": { "AccountId": { "S": "B456" } },
      "UpdateExpression": "SET Balance = Balance + :amt",
      "ExpressionAttributeValues": { ":amt": { "N": "100" } }
    }
  }
]
```

Then run:

```bash
aws dynamodb transact-write-items \
  --transact-items file://transact-items.json \
  --client-request-token transfer-req-001
```

Here:

- We use a `ConditionExpression` on the debit side to ensure Account A has enough balance.
- We pass a client request token for idempotency (so repeating the same command doesn’t double debit or credit).
- If either update fails (e.g. insufficient balance, or some other error), the other does not execute — atomic behavior.

Another example (from AWS docs) showing `Put` + `Delete`: ([AWS Documentation][2])

```json
[
  {
    "Update": {
      "Key": {
        "Artist": { "S": "Acme Band" },
        "SongTitle": { "S": "Happy Day" }
      },
      "TableName": "MusicCollection",
      "UpdateExpression": "SET AlbumTitle = :newval",
      "ExpressionAttributeValues": {
        ":newval": { "S": "Updated Album Title" }
      },
      "ConditionExpression": "attribute_not_exists(Rating)"
    }
  },
  {
    "Delete": {
      "Key": {
        "Artist": { "S": "No One You Know" },
        "SongTitle": { "S": "Call Me Today" }
      },
      "TableName": "MusicCollection",
      "ConditionExpression": "attribute_not_exists(Rating)"
    }
  }
]
```

You run:

```bash
aws dynamodb transact-write-items --transact-items file://transact-items.json
```

If any condition check fails, the transaction fails. ([AWS Documentation][2])

### `transact-get-items`

This is for reading multiple items atomically in one operation. You supply multiple `Get` requests. ([fig.io][4])

For example:

```json
{
  "TransactItems": [
    {
      "Get": {
        "TableName": "Users",
        "Key": { "UserId": { "S": "user1" } }
      }
    },
    {
      "Get": {
        "TableName": "Orders",
        "Key": { "OrderId": { "S": "order123" } }
      }
    }
  ]
}
```

CLI:

```bash
aws dynamodb transact-get-items --transact-items file://get-items.json
```

This returns both items (if they exist), or fails if any read cannot be satisfied.

### `execute-transaction` (PartiQL-style)

In newer versions, AWS supports a PartiQL-based transaction API via `execute-transaction`. This allows you to issue SQL-like statements inside a transaction. ([AWS Documentation][5])

Example:

```bash
aws dynamodb execute-transaction \
  --transact-statements '[
    {
      "Statement": "UPDATE Account SET Balance = Balance - ? WHERE AccountId = ?",
      "Parameters": [
        { "N": "100" },
        { "S": "A123" }
      ]
    },
    {
      "Statement": "UPDATE Account SET Balance = Balance + ? WHERE AccountId = ?",
      "Parameters": [
        { "N": "100" },
        { "S": "B456" }
      ]
    }
  ]' \
  --client-request-token txn123
```

This is syntactic sugar / an alternate interface over the underlying transaction APIs. (You still can’t mix reads and writes in one transaction here.) ([AWS Documentation][1])

---

## Using SDK v3 (JavaScript / TypeScript)

Now let’s deep dive into how to do DynamoDB transactions via the AWS SDK v3, especially with `@aws-sdk/client-dynamodb` and optionally `@aws-sdk/lib-dynamodb` (Document abstraction).

---

### Setup

```ts
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  TransactGetItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Create a low-level DynamoDB client
const client = new DynamoDBClient({ region: "us-east-1" });

// Optionally wrap into Document client, which handles marshalling/unmarshalling (i.e. converting JS types ↔ DynamoDB AttributeValue types)
const ddbDoc = DynamoDBDocumentClient.from(client);
```

The Document client simplifies parameters: you can use normal JS objects rather than manually specifying `{ S: "string", N: "123" }` etc. However — caveat — not all transaction features might be fully supported via the Document abstraction. (There have been issues reported for `transactWrite()` with `Put` inside the Document client. ([GitHub][6]))

---

### Simple TransactWriteItems Example

Let’s revisit the “transfer money” scenario in code:

```ts
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

async function transferFunds(
  accountFrom: string,
  accountTo: string,
  amount: number
) {
  const client = new DynamoDBClient({ region: "us-east-1" });
  const ddbDoc = DynamoDBDocumentClient.from(client);

  const params = {
    TransactItems: [
      {
        Update: {
          TableName: "Accounts",
          Key: { AccountId: accountFrom },
          UpdateExpression: "SET Balance = Balance - :amt",
          ConditionExpression: "Balance >= :amt",
          ExpressionAttributeValues: {
            ":amt": amount,
          },
        },
      },
      {
        Update: {
          TableName: "Accounts",
          Key: { AccountId: accountTo },
          UpdateExpression: "SET Balance = Balance + :amt",
          ExpressionAttributeValues: {
            ":amt": amount,
          },
        },
      },
    ],
    ClientRequestToken: `tx-${Date.now()}-${accountFrom}-${accountTo}`,
  };

  const cmd = new TransactWriteItemsCommand(params);
  try {
    const res = await client.send(cmd);
    console.log("Transfer succeeded", res);
  } catch (err) {
    console.error("Transfer failed", err);
    throw err;
  }
}
```

Notes:

- We use `ConditionExpression` on the first update to ensure the source account has sufficient funds. If that fails, the entire transaction fails and the second update is not applied.
- We supply a `ClientRequestToken` for idempotency.
- If any update errors (due to conditional check failure, capacity, etc.), the entire command throws an error and no partial state is left.

You could also use the `ddbDoc` wrapper to simplify types (so you don’t have to wrap values as `{ N: "123" }`), but be cautious about feature support.

Here's a variant using Document client:

```ts
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

async function transferFundsDoc(a: string, b: string, amt: number) {
  const client = new DynamoDBClient({ region: "us-east-1" });
  const ddbDoc = DynamoDBDocumentClient.from(client);

  const params = {
    TransactItems: [
      {
        Update: {
          TableName: "Accounts",
          Key: { AccountId: a },
          UpdateExpression: "SET Balance = Balance - :amt",
          ConditionExpression: "Balance >= :amt",
          ExpressionAttributeValues: {
            ":amt": amt,
          },
        },
      },
      {
        Update: {
          TableName: "Accounts",
          Key: { AccountId: b },
          UpdateExpression: "SET Balance = Balance + :amt",
          ExpressionAttributeValues: {
            ":amt": amt,
          },
        },
      },
    ],
    ClientRequestToken: `tx-${Date.now()}`,
  };

  const cmd = new TransactWriteCommand(params);
  try {
    const result = await ddbDoc.send(cmd);
    console.log("Success", result);
  } catch (e) {
    console.error("Failed", e);
    throw e;
  }
}
```

**Important:** When using `@aws-sdk/lib-dynamodb`’s `transactWrite()`, there have been reported bugs (e.g. `Invalid attribute value type`) when using `Put` operations. So always test thoroughly. ([GitHub][6])

---

### TransactGetItems Example

Suppose you want to fetch a user's profile and their account simultaneously in a single, consistent read:

```ts
import { TransactGetItemsCommand } from "@aws-sdk/client-dynamodb";

async function getUserAndAccount(userId: string) {
  const client = new DynamoDBClient({ region: "us-east-1" });
  const params = {
    TransactItems: [
      {
        Get: {
          TableName: "Users",
          Key: { UserId: userId },
        },
      },
      {
        Get: {
          TableName: "Accounts",
          Key: { AccountId: userId }, // say account id = user id
        },
      },
    ],
  };

  const cmd = new TransactGetItemsCommand(params);
  const resp = await client.send(cmd);
  return resp.Responses; // array of items
}
```

If either item is missing or cannot be fetched, the call fails.

---

### Advanced / Complex Scenarios & Patterns

#### Conditional Checks & Pre-checks

You can embed `ConditionCheck` actions within a transaction. For example, you might want to ensure that some condition is true before proceeding with multiple writes.

```ts
{
  ConditionCheck: {
    TableName: "Inventory",
    Key: { ItemId: "item123" },
    ConditionExpression: "Stock >= :req",
    ExpressionAttributeValues: { ":req": 10 }
  }
}
```

Combined with updates or deletes elsewhere.

#### Idempotency & ClientRequestToken

By supplying a `ClientRequestToken`, you make the transaction idempotent over a short window (typically ~10 minutes). That means if the same token and operations are submitted again, DynamoDB recognizes it as the same transaction rather than executing it again. ([AWS Documentation][2])

Be cautious: if you submit with the same token but different operations, you might get an `IdempotentParameterMismatch` error. ([AWS Documentation][7])

#### Retry Logic & Conflicts

Because of concurrency, transactions can fail with exceptions like `TransactionCanceledException` (due to conflicts or condition failures). Typical practice is to catch such errors and retry (with a small back-off). SDKs often do some retries automatically for certain retriable errors. But application-level retry logic is recommended. ([AWS Documentation][3])

#### Splitting Large Transactions / Saga Pattern

Transactions have limits (max items, size). If your workflow needs more than the transaction limits, you may need application-level orchestration (e.g. Saga pattern, compensating transactions). For example, break a big logical operation into multiple smaller transactions and handle rollbacks manually (or via state machines). Many systems use Step Functions + DynamoDB to manage long workflows.

Also, some use the “transaction table + image table” pattern to record in-flight operations and clean up (a form of custom logic over vanilla DynamoDB). (Earlier AWS Labs client-side transaction libraries did this.) ([GitHub][8])

#### Unique constraint enforcement

One common use case is enforcing uniqueness across attributes (e.g. unique email). Since DynamoDB doesn’t natively support unique constraints across items, you can implement it via a transaction: insert a “uniqueness marker” row plus the actual data, with condition expressions ensuring the marker does not already exist. AWS has an article about simulating unique constraints using transactions. ([Amazon Web Services, Inc.][9])

Example (CLI from AWS):

```bash
aws dynamodb transact-write-items --client-request-token TRANSACTION1 --transact-items '[
  {
    "Put": {
      "TableName": "User",
      "ConditionExpression": "attribute_not_exists(pk)",
      "Item": {
        "pk": { "S": "user#123" },
        "username": { "S": "bob" },
        "email": { "S": "bob@example.com" }
      }
    }
  },
  {
    "Put": {
      "TableName": "UsersByEmail",
      "ConditionExpression": "attribute_not_exists(email)",
      "Item": {
        "email": { "S": "bob@example.com" },
        "pk": { "S": "user#123" }
      }
    }
  }
]'
```

This ensures that email is unique, because the second `Put` in `UsersByEmail` will fail if the email entry already exists.

#### Real-world Example: Order Processing

A classic real-world use case is an e‑commerce order:

Tables:

- `Customers` (pk = CustomerId)
- `Inventory` (pk = ProductId)
- `Orders` (pk = OrderId)

When a customer places an order, you might want to:

1. Deduct inventory for the products ordered.
2. Create an order entry.
3. Update the customer’s order history.

You want all three to succeed or fail together.

You could use a transaction:

```ts
TransactItems: [
  {
    Update: {
      TableName: "Inventory",
      Key: { ProductId: "P123" },
      UpdateExpression: "SET Stock = Stock - :qty",
      ConditionExpression: "Stock >= :qty",
      ExpressionAttributeValues: { ":qty": 2 },
    },
  },
  {
    Put: {
      TableName: "Orders",
      Item: {
        OrderId: "O789",
        CustomerId: "C456",
        Products: [{ productId: "P123", qty: 2 }],
        Total: 49.99,
      },
      ConditionExpression: "attribute_not_exists(OrderId)",
    },
  },
  {
    Update: {
      TableName: "Customers",
      Key: { CustomerId: "C456" },
      UpdateExpression: "SET LastOrder = :oid",
      ExpressionAttributeValues: { ":oid": "O789" },
    },
  },
];
```

If inventory is insufficient, or order ID is duplicate, or customer update fails, the entire transaction aborts, leaving no partial state.

AWS has a worked example in their docs under “transaction example” (online marketplace) showing this pattern. ([AWS Documentation][10])

---

## Deep Dive: Internals, Limits, Performance, and Caveats

### Capacity & Costs

- Because of the prepare + commit phases, each item in a transaction is read/written twice. So transactions consume double capacity compared to single operations. You must plan RCU/WCU accordingly. ([AWS Documentation][3])
- When enabling transactions, you pay only for the reads/writes that are part of the transaction (double cost accounted). ([AWS Documentation][3])
- Default SDK behavior includes retries for `TransactionInProgressException` etc., so your application might consume additional RCUs/WCUs due to retries. ([AWS Documentation][3])

### Limits & Constraints

- Maximum number of items per transaction: Historically 25 for reads (TransactGet) and 100 for writes (TransactWrite), but these limits may vary or have increased. Always check the AWS regional limits. ([AWS Documentation][2])
- Total size limit: 4 MB aggregate across all items in the transaction. ([AWS Documentation][2])
- You cannot operate on the same item more than once within a single transaction (e.g. you can’t `Update` and `Delete` the same item in the same transaction). ([AWS Documentation][2])
- You cannot mix read and write operations in one transaction (for `ExecuteTransaction`). For the older APIs, writes and reads are separate APIs (TransactWrite / TransactGet). ([AWS Documentation][1])
- The transaction must operate on tables in the same AWS account and same region (no cross-region or cross-account). ([AWS Documentation][2])
- There is a limit on item collection metrics / return values.
- The transaction item operations (Put, Update, Delete, ConditionCheck) have their usual constraints (expression sizes, attribute names, etc.).
- DynamoDB Streams ordering: If you have a multi-item transaction, the stream records might not preserve the _order of writes across items_ (though within a single item, the changes are ordered). This is a nuance often overlooked. (One user observed that stream ordering across transaction items is not guaranteed) ([Reddit][11])

### Concurrency, Contention & Cancellation

- When many transactions concurrently target the same items, conflicts may occur and transactions get aborted (canceled) — you’ll see `TransactionCanceledException`. You need to catch and retry with back-off.
- Condition failures also cause cancellation.
- You should design your data model to minimize hotspots — avoid many concurrent transactions writing to the same partition / item.
- Larger transactions have a higher chance of conflict or cancellation, so keep them as small and simple as possible. ([AWS Documentation][3])

### Error Handling & Exceptions

Common exceptions to handle:

- `TransactionCanceledException`: the most common, indicating some operation in the transaction failed (due to conditional checks, conflicts, etc.). You should inspect the cancellation reasons and decide whether to retry or abort.
- `ProvisionedThroughputExceededException` or `ThrottlingException`: the transaction consumed too much capacity; you might back off and retry.
- `IdempotentParameterMismatchException`: if you reuse a `ClientRequestToken` but change parameters.
- `InternalServerError` or service exceptions: apply retry logic.
- `ValidationException`: e.g. invalid parameter values or exceeding limits.

When catching `TransactionCanceledException`, the error includes the reasons for each item (which sub‑operation failed and why). Use that to inform whether a retry is safe or not.

### Best Practices

- Keep transactions small (few items, minimal attributes).
- Avoid long-running transactions or mixing with heavy logic inside a transaction.
- Use `ClientRequestToken` to make your transactions idempotent (especially useful for retries).
- Add exponential back-off / jitter when retrying.
- Try to design so that items updated in transactions are not heavily contended.
- Use transactions only when really needed (i.e. when atomicity across multiple items is required). For bulk writes, use `BatchWrite` instead (which is more efficient but not atomic). ([AWS Documentation][3])
- Use PartiQL `execute-transaction` when it provides cleaner syntax.
- Monitor and provision capacity considering the double usage overhead.
- Test thoroughly in high concurrency to catch conflicts.

---

## Interview-style Questions (with Answers / Talking Points)

Here are some potential interview questions around DynamoDB transactions, and how you can answer or discuss them.

1. **What guarantees do DynamoDB transactions provide?**

   - They provide **atomicity** (all or nothing), **isolation** (transaction changes are not visible mid-way), **consistency** (you can enforce conditions), **durability** (committed changes persist).
   - They support multi-item, multi-table operations within the same region/account.

2. **What is the difference between `TransactWriteItems` and `BatchWriteItem`?**

   - `BatchWriteItem` is a non-transactional bulk write; some writes may succeed while others fail, it’s not atomic.
   - `TransactWriteItems` is transactional: either all succeed or none.
   - `TransactWrite` also supports conditional checks, idempotency tokens, and atomic consistency.

3. **How many items can a transaction operate on?**

   - Historically, up to 25 for `TransactGetItems`, up to 100 for `TransactWriteItems`, with a total size ≤ 4 MB. But you should check current service limits per region.
   - Cannot exceed these limits; otherwise you must split across multiple transactions or use alternative patterns.

4. **Can you mix read and write operations in a single transaction?**

   - In the classic API, you cannot. You use `TransactGetItems` for reads and `TransactWriteItems` for writes.
   - With the newer PartiQL `ExecuteTransaction`, you also cannot mix read and write statements in one transaction. ([AWS Documentation][1])

5. **What are common reasons a transaction gets cancelled?**

   - Condition check fails (e.g. `ConditionExpression` is false).
   - Conflict / contention with another concurrent transaction.
   - Throttling / lack of capacity.
   - Internal or validation errors (exceeding item size, limits, invalid expressions).

6. **How do you handle transaction retries?**

   - Catch `TransactionCanceledException` and inspect the cancellation reasons.
   - Retry with exponential back-off and jitter.
   - Use `ClientRequestToken` for idempotency so repeated attempts don’t cause duplicate effects.
   - Limit the number of retries.

7. **Explain how transactions consume capacity (RCU / WCU).**

   - Because of the prepare + commit phases, each item in the transaction is read or written twice.
   - So capacity cost is roughly double what a single write or read would consume.
   - Also, retries will further increase capacity usage.

8. **What limitations or pitfalls exist with DynamoDB transactions?**

   - Limits on number of items and total payload size.
   - Higher latency and throughput cost.
   - Susceptibility to conflict / cancellation under contention.
   - Not suitable for bulk ingestion.
   - Some features might not fully work with Document client wrappers.
   - DynamoDB Streams ordering not guaranteed across transaction items.
   - You can’t mix read + write in a transaction.

9. **How would you implement a unique constraint (e.g. unique username / email) in DynamoDB using transactions?**

   - Use a transaction that writes the user item **and** writes a marker / lookup table entry (e.g. `UsersByEmail`) with condition expressions ensuring the marker doesn’t already exist.
   - If the marker exists, the transaction fails (ensuring uniqueness).
   - Example is in AWS’s “Simulating unique constraints” article. ([Amazon Web Services, Inc.][9])

10. **If your operation logically affects 500 items, how do you handle that given transaction limits?**

    - You cannot do a single transaction for 500 items due to limits. You’d need to break into multiple smaller transactions.
    - Use a Saga / compensating transaction pattern: you apply pieces in order, and if one fails, roll back previous ones.
    - Alternatively, use a different database system for that workflow if atomicity across so many items is required.

---

## Advanced / “Edge” Considerations

- **Transactions + Global Tables / Replication**: Be cautious when using transactions with global (multi-region) tables. Some consistency / conflict resolution behavior may apply.
- **PartiQL support**: `execute-transaction` works with SQL-like statements, possibly improving developer productivity.
- **Document client limitations**: As flagged above, the higher-level wrapper may not support all transaction features (bugs have been reported). Always test core transaction logic using the low-level client.
- **Stream ordering nuance**: DynamoDB Streams **does not guarantee order across items** in the same transaction. If you have downstream consumers that assume strict transaction-level ordering, this could be a problem. ([Reddit][11])
- **Large attribute / big item transactions**: Because of the 4 MB size limit, if items are very large, you might hit limits.
- **Transaction browse / rollback for partial failures**: The `TransactionCanceledException` includes metadata about which operation failed and why; you should inspect that to know which commit failed.
- **Compound conditional logic**: Sometimes you may want to do cross-item conditional logic (e.g. “If A.x + B.y > 10 then update both”). You have to encode conditions carefully, or sometimes you need to read first and then perform the transaction.
- **Nested transactions**: You can’t nest transactions (i.e. no “sub-transaction” inside a transaction), so your logic must flatten operations.
- **Timeout / latency**: Transactions introduce more latency (two-phase commit) compared to simple operations. For high-throughput, low-latency use cases, minimize transaction usage.
- **Hot partitions**: If many transactions hit the same partition or item, you’ll get contention and cancellations. Be mindful in your data model.
- **Idempotent token lifetime**: The `ClientRequestToken` is valid only for a limited time (e.g. ~10 minutes). After that window, a repeated token is treated as new. So your retry strategy must account for that.
- **Cross-service orchestration**: If you need to coordinate across DynamoDB + other systems (e.g. S3, Lambda, SNS), then you must manage distributed transaction patterns or use orchestration frameworks (e.g. Saga, Step Functions).

---

## Step-by-Step Walkthrough: From Zero to Transaction in v3 SDK

Let me lay out a step-by-step process you might follow when building a feature with transactions:

1. **Design data model**: Identify which items across which tables need to be modified atomically. Try to minimize the number of items / complexity.

2. **Define transaction logic**: For the workflow, decide which operations (Put / Update / Delete / ConditionCheck) must be grouped.

3. **Write parameter structure**: Prepare a `TransactItems` array according to the SDK’s format (low-level or doc client). Ensure no duplicate item operations, valid keys, proper expressions, etc.

4. **Generate a `ClientRequestToken`**: Use a UUID or timestamp-based token to support idempotency.

5. **Send the transaction command**: Use `client.send(new TransactWriteItemsCommand(params))` or `ddbDoc.send(new TransactWriteCommand(params))`.

6. **Catch errors**:

   - On `TransactionCanceledException`, inspect the cancellation reasons and determine whether to retry or abort.
   - On throughput or throttling errors, back off and retry.
   - On validation or non-retriable errors, abort and bubble error to caller.

7. **Retry logic**: Implement exponential back-off + jitter for retrying transactions. Make sure retries don’t exceed token window or cause mismatches.

8. **Logging & instrumentation**: Log transaction attempts, reasons for failure, metrics (latency, capacity units consumed). Use CloudWatch metrics to monitor transaction performance.

9. **Test under concurrency**: Simulate high concurrency to see conflict rates, cancellations, and tune your model / retry logic.

10. **Fallback / compensation**: If transaction fails permanently, have fallback paths or compensation logic (e.g. send user error, roll back via business logic, etc.)

11. **Monitor & scale**: Provision capacity appropriately (consider doubling for transaction overhead), monitor throttling, errors, and adjust.

---

## Real-World Use Case / Scenario

### Use Case: Multi-Item Account Transfer System

Suppose you’re building a banking or fintech application where users have multiple wallets/accounts. You want to transfer money from one wallet to another, while also creating a transaction record, updating user balances, and perhaps logging a history entry — all atomically.

Tables:

- `Wallets` (pk = `WalletId`) containing fields like `Balance`, `UserId`
- `Transactions` (pk = `TxId`) recording transaction metadata
- `Users` (pk = `UserId`) storing aggregate stats like `TotalBalance`

When user wants to transfer `X` from wallet A to wallet B:

1. **ConditionCheck / Update**: Deduct X from wallet A, ensure balance ≥ X
2. **Update**: Add X to wallet B
3. **Put**: Insert a record in `Transactions` table with `TxId`, `fromWallet`, `toWallet`, `amount`, `timestamp`
4. **Update**: Update `Users` table (if needed, e.g. recalc `TotalBalance` or last activity)

You put these four operations into a single transaction `TransactWriteItems`. If any fails (say insufficient funds, or duplicate transaction Id), the entire transaction fails.

You would likely:

- Use a strong unique transaction ID (UUID) with `ConditionExpression` to ensure no duplicate `TxId`.
- Use `ClientRequestToken` for idempotency (so retries don’t duplicate).
- Expect occasional retries under concurrency.

This ensures correctness: money is neither created nor lost; either the full transfer + record logs succeed, or none do.

If your system also interacts with external services (e.g. notifying via SNS, updating external ledger), you might wrap this in a Saga: DynamoDB transaction is step one; if later steps fail, you perform compensating actions (refund, rollback) as needed.

---

## Summary & Key Takeaways

- DynamoDB transactions give you atomic, isolated, consistent, durable operations across multiple items / tables.
- Use `TransactWriteItems` (or PartiQL `execute-transaction`) for writes, `TransactGetItems` for reads.
- They carry higher cost, throughput overhead, and risk of conflicts, so only use when necessary.
- Handle retries, cancellation, idempotency, and contention carefully.
- For very large logical operations, break into smaller transactions or use orchestration / Saga patterns.
- Watch out for limitations and caveats of wrappers like Document client.
- In interviews, you should be able to explain how transactions work, trade-offs, sample code, and pitfalls.

Great question! The info I shared is up-to-date as of late 2025, based on the latest AWS docs, SDK v3 (JavaScript/TypeScript), and current best practices.

To make you a **true DynamoDB transactions expert**, let me deepen this further with:

- Latest **transaction use cases** in modern apps
- **Limitations and gotchas** in production
- Alternative / complementary **design patterns**
- Performance & cost considerations
- Real-world advice and pitfalls
- FAQs & common interview questions

---

# 1. **Deepest DynamoDB Transaction Use Cases**

### 1.1 Atomic Cross-Item Updates (Multi-Table / Multi-Item ACID)

- Transfer money between bank accounts (debit + credit)
- Booking systems (reserve seat + update availability)
- E-commerce order + inventory deduction + payment state update
- User signup + uniqueness enforcement on email/username (using a marker item)
- Multi-step workflows requiring consistent state across several items or tables

### 1.2 Conditional Uniqueness Enforcement

DynamoDB does NOT have unique constraints. You simulate it with transactions:

- Insert user profile
- Insert "email" item to track uniqueness
- Both `Put`s with condition `attribute_not_exists()` for uniqueness guarantee
- Entire transaction aborts if email already taken

### 1.3 Distributed Locks and Semaphores

Using transactions combined with conditional writes and TTL (time to live) attributes, you can implement lightweight locking or concurrency control on items.

---

# 2. **Advanced Limitations & Gotchas**

### 2.1 Transaction Size & Item Count Limits

- Max **100 items** per `TransactWriteItems`
- Max **25 items** per `TransactGetItems`
- Max payload size **4 MB** per transaction (sum of all items)
- Cannot operate multiple times on the **same item** in one transaction (no Update + Delete on same item)
- All tables must be in the **same AWS region and account**

### 2.2 Cannot Mix Reads and Writes in Same Transaction

- `TransactWriteItems` is for writes (Put, Update, Delete, ConditionCheck)
- `TransactGetItems` is for reads
- The newer PartiQL `ExecuteTransaction` API also does **not** allow mixing reads and writes in one transaction

### 2.3 Transaction Throttling and Capacity

- Transactions consume about **2x capacity units** (read/write) due to two-phase commit
- Heavy transaction use can lead to `TransactionCanceledException` due to conflicts or throttling
- Transactions are more expensive than single-item ops — use only when needed

### 2.4 Stream Ordering and Eventual Consistency

- DynamoDB Streams do not guarantee the order of writes **across multiple items in a transaction**
- Each item’s change is ordered, but cross-item ordering is undefined, which can confuse downstream event processing
- Design your stream consumers accordingly

### 2.5 Idempotency Token Caveats

- Reusing the same `ClientRequestToken` with different requests causes errors
- Tokens are valid for a short time window (~10 minutes)
- Use tokens carefully to avoid duplicate effects and errors

---

# 3. **Alternative & Complementary Patterns**

### 3.1 Single-Item Conditional Updates Instead of Transactions

If your use case allows, design data to avoid multi-item transactions by:

- Embedding related info into one item (e.g. JSON document)
- Use conditional `UpdateItem` to prevent overwrites

### 3.2 Application-Level Sagas

For workflows too big for a single transaction (e.g. involving >100 items or complex side effects):

- Implement Saga pattern with compensating actions
- Use AWS Step Functions + DynamoDB for orchestration
- Transactions only used for **critical** atomic steps

### 3.3 Lightweight Transactions via Optimistic Locking

- Use DynamoDB’s `ConditionExpression` + a version number attribute (`version`)
- On update, increment `version` only if current `version` matches (optimistic concurrency)
- Less expensive than full transactions, but not multi-item atomic

---

# 4. **Performance & Cost**

- Transactions consume roughly **2x** read/write units (due to prepare + commit phases)
- Latency is higher than single-item ops (due to coordination)
- Throttling more likely under contention or burst usage
- For hot partitions or heavy write concurrency, transactions can suffer aborted retries
- Always monitor CloudWatch metrics for `TransactionThrottledRequests` and errors
- Use exponential backoff & jitter in retry logic

---

# 5. **Real-World Pitfalls & How to Avoid**

| Pitfall                                                  | How to Avoid                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| High contention on same item in transactions             | Design data for low contention; shard keys if needed                          |
| Ignoring transaction capacity impact                     | Double your throughput allocation for transactional workloads                 |
| Assuming stream ordering across items                    | Design idempotent downstream consumers                                        |
| Mixing reads and writes in one transaction (not allowed) | Use separate `TransactGetItems` and `TransactWriteItems` calls or split logic |
| Not handling `TransactionCanceledException`              | Always catch and retry with backoff, check cancellation reasons               |

---

# 6. **Interview-Style Questions**

- Explain the difference between `TransactWriteItems` and `TransactGetItems`.
- How do you enforce uniqueness constraints in DynamoDB?
- What are the limitations of DynamoDB transactions?
- How would you handle contention or throttling errors in DynamoDB transactions?
- When should you avoid using transactions and what alternatives exist?
- How does DynamoDB achieve atomicity and isolation in transactions under the hood?

---

# 7. **Summary Cheat Sheet**

| Feature                 | DynamoDB Transaction Info                                    |
| ----------------------- | ------------------------------------------------------------ |
| Max items per write txn | 100                                                          |
| Max items per read txn  | 25                                                           |
| Max total size          | 4 MB                                                         |
| Can mix reads & writes? | No                                                           |
| ACID support            | Yes                                                          |
| Idempotency support     | ClientRequestToken (short window)                            |
| Cost                    | ~2x capacity units per item                                  |
| Common failure          | TransactionCanceledException (conflicts, condition failures) |
| Stream ordering         | Per item only, no cross-item order guarantee                 |

---

If you want, I can also prepare:

- Sample **complete SDK v3 transaction projects**
- A **step-by-step real-world app design** with transactions
- A **cheat sheet PDF** or slide deck for quick reference

---

Would you like me to focus on any specific use case, code sample, or architecture scenario next?

Got it! You want a **focused, ultra-deep dive** specifically on **DynamoDB transactions only** — everything important about them, no fluff.

I’ll give you:

- Core concepts & components
- SDK v3 focused patterns & example snippets
- Transaction-specific best practices & limitations
- Real-world transaction-centric use cases
- Advanced troubleshooting & gotchas
- Interview questions on transactions only
- A focused cheat sheet at the end

---

# DynamoDB Transactions — Ultra Deep Dive

---

## 1. **Core Concepts**

- **ACID guarantees** in DynamoDB transactions:

  - **Atomicity**: All operations succeed or none.
  - **Consistency**: Data always moves from one valid state to another.
  - **Isolation**: Transactions are isolated from each other (serializable isolation).
  - **Durability**: Committed transactions persist even if failure occurs.

- Two main APIs:

  - `TransactWriteItems` — transactional writes (Put, Update, Delete, ConditionCheck)
  - `TransactGetItems` — transactional reads (read multiple items atomically)

- **No mixing reads & writes** in a single transaction call.

- Maximum:

  - 100 items in a `TransactWriteItems`
  - 25 items in a `TransactGetItems`
  - Max 4 MB total data per transaction

---

## 2. **SDK v3 Key Patterns**

- Use `TransactWriteCommand` for writes, `TransactGetCommand` (or `TransactGetItems`) for reads.
- Example **transactional write** with condition:

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

async function transactionExample() {
  const params = {
    TransactItems: [
      {
        Put: {
          TableName: "Users",
          Item: { userId: "u123", email: "a@b.com" },
          ConditionExpression: "attribute_not_exists(userId)", // ensure uniqueness
        },
      },
      {
        Update: {
          TableName: "Emails",
          Key: { email: "a@b.com" },
          UpdateExpression: "SET userId = :uid",
          ConditionExpression: "attribute_not_exists(email)",
          ExpressionAttributeValues: { ":uid": "u123" },
        },
      },
    ],
  };

  await ddbDocClient.send(new TransactWriteCommand(params));
}
```

- On failures, SDK throws `TransactionCanceledException` with `CancellationReasons` indicating which condition failed.

---

## 3. **Important Limitations and Gotchas**

| Limitation                            | Details                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cannot update same item twice         | No multiple operations on same item in one transaction (e.g., Update + Delete on same key) |
| Max 100 write items, 25 read items    | Hard limits per transaction                                                                |
| Total payload max 4MB                 | Sum of all item sizes included                                                             |
| No mixing reads and writes            | Separate calls for reads vs writes                                                         |
| Transactions are more costly & slower | Use only when you truly need atomicity                                                     |
| Conditional failures cause abort      | Entire transaction rolls back                                                              |
| High contention causes throttling     | Can get `TransactionCanceledException` due to conflicts, require retry logic               |
| Stream ordering is per item only      | No cross-item ordering guarantee on streams                                                |

---

## 4. **Real-World Transaction Use Cases**

### 4.1 Unique Constraint Enforcement

- DynamoDB lacks unique constraints.
- Use transaction with `ConditionExpression` to simulate:

  - Put user item
  - Put email tracking item

- Abort if email exists

### 4.2 Atomic State Transitions

- Multi-item workflows (e.g. order + inventory deduction + payment)
- Change multiple items state atomically (e.g., `PENDING` → `CONFIRMED`)

### 4.3 Bank Transfers / Balance Updates

- Debit one account, credit another atomically with condition on sufficient funds

### 4.4 Reservation Systems

- Reserve seat + decrement availability atomically

---

## 5. **Best Practices**

- **Use Condition Expressions** in transactions to enforce business rules.
- **Minimize item count** per transaction to avoid hitting limits.
- **Design data models to reduce contention** — e.g., use sharding keys.
- **Use exponential backoff and jitter** when retrying on `TransactionCanceledException`.
- **Monitor throttling metrics** and increase capacity if needed.
- **Avoid mixing reads & writes** in a single workflow by splitting calls.
- Consider **optimistic concurrency control** (`version` attribute) if full transactions are too heavy.
- For large or long workflows, use **Saga pattern** with compensating transactions.

---

## 6. **Troubleshooting and Error Handling**

- `TransactionCanceledException`:

  - Inspect `CancellationReasons` to find cause (conditional failure, capacity limit, etc.)
  - Retry if due to conflicts or throttling

- Handle `ProvisionedThroughputExceededException` when transaction capacity is exceeded.
- Use idempotency tokens (`ClientRequestToken`) to prevent duplicate effects on retry.
- Be aware of transaction latencies — expect higher latency than single item operations.

---

## 7. **Common Interview Questions**

1. What are the atomicity and isolation guarantees of DynamoDB transactions?
2. How do you enforce uniqueness constraints with DynamoDB transactions?
3. What are the limits on transaction size and item counts in DynamoDB?
4. Why can’t you mix reads and writes in a single DynamoDB transaction?
5. How do you handle conflicts and retries in DynamoDB transactions?
6. When would you avoid DynamoDB transactions and what alternatives exist?
7. What happens if a condition expression fails inside a transaction?
8. How does DynamoDB achieve ACID guarantees internally?
9. Can you update the same item twice in a single transaction?
10. What is the effect of transactions on DynamoDB Streams ordering?

---

## 8. **Focused Cheat Sheet**

| Aspect                      | Details                                     |
| --------------------------- | ------------------------------------------- |
| Max Items per TransactWrite | 100                                         |
| Max Items per TransactGet   | 25                                          |
| Max Payload Size            | 4 MB                                        |
| Mixing Reads & Writes       | Not allowed                                 |
| Atomicity                   | All or nothing                              |
| Isolation                   | Serializable isolation                      |
| Cost                        | ~2x capacity units per item                 |
| Failure Handling            | `TransactionCanceledException` with reasons |
| Conditional Expressions     | Supported for enforcing business rules      |
| Same item multiple ops      | Not allowed                                 |
| Idempotency Token           | `ClientRequestToken` for deduplication      |

---

If you want, I can also package this as a PDF or slides focused only on transactions!

---

Would you like me to prepare that next? Or help with a specific transaction-related SDK example?
Okay — let’s do a full, detailed deep dive on the **frequently used DynamoDB commands** (CLI + SDK) one by one, not skipping. This will cover:

- `execute-transaction`
- `transact-write-items`
- `transact-get-items`
- `query`
- `scan`
- `put-item` / `get-item` / `update-item` / `delete-item`
- `batch-write-item` / `batch-get-item`

I’ll go command by command, giving you: purpose, CLI syntax, detailed examples, SDK v3 (Node.js) usage, edge cases, best practices, and interview‑style questions. Let’s begin with:

---

## 1. `execute-transaction` (PartiQL transactional operations)

### 🧭 Purpose

- Allows you to execute **multiple PartiQL statements** (all read or all write) in a **transactional (atomic)** context. Either **all succeed or all fail**.
- You cannot mix SQL reads and writes in the same `execute-transaction` (i.e., all statements must be reads or all must be writes). The exception is the use of `EXISTS` in a read-style check. ([AWS Documentation][1])
- The limit on number of statements was historically 25, but AWS announced support for up to 100 actions per transaction as of Sept 2022. ([Amazon Web Services, Inc.][2])
- Useful when you need strong consistency and atomicity across multiple items (e.g. banking transfers, multi‑table invariants) while using PartiQL syntax.

---

### 🛠 CLI Syntax & Options

From AWS CLI docs: ([AWS Documentation][1])

```
aws dynamodb execute-transaction
  --transact-statements <value>
  [--client-request-token <value>]
  [--return-consumed-capacity <value>]
  [--cli-input-json | --cli-input-yaml]
  [--generate-cli-skeleton <value>]
  [--debug]
  [--endpoint-url <value>]
  [--no-verify-ssl]
  [--no-paginate]
  [--output <value>]
  [--query <value>]
  [--profile <value>]
  [--region <value>]
```

Key flags explained:

- `--transact-statements`: a JSON list/array of statements (each with `Statement`, optional `Parameters`, optional `ReturnValuesOnConditionCheckFailure`)
- `--client-request-token`: idempotency token to ensure same transaction isn’t applied multiple times
- `--return-consumed-capacity`: “NONE”, “TOTAL”, or “INDEXES” to get capacity usage breakdown
- `--cli-input-json` or `--cli-input-yaml`: supply input via a file or JSON
- `--debug`: print detailed HTTP/SDK request logs

---

### 💡 CLI Example: Transactional Write (PartiQL)

Suppose you have two tables, `Accounts` and `Transactions`, and you want to move money from user A to user B atomically (deduct from A, add to B, and log a transaction record).

Create `txn.json`:

```json
{
  "TransactStatements": [
    {
      "Statement": "UPDATE Accounts SET balance = balance - ? WHERE userId = ? IF balance >= ?",
      "Parameters": [{ "N": "100" }, { "S": "userA" }, { "N": "100" }],
      "ReturnValuesOnConditionCheckFailure": "ALL_OLD"
    },
    {
      "Statement": "UPDATE Accounts SET balance = balance + ? WHERE userId = ?",
      "Parameters": [{ "N": "100" }, { "S": "userB" }]
    },
    {
      "Statement": "INSERT INTO Transactions VALUE {'txnId': ?, 'from': ?, 'to': ?, 'amount': ?}",
      "Parameters": [
        { "S": "txn123" },
        { "S": "userA" },
        { "S": "userB" },
        { "N": "100" }
      ]
    }
  ]
}
```

Then run:

```bash
aws dynamodb execute-transaction --cli-input-json file://txn.json
```

If any of the updates/inserts fail (e.g. condition check fails, insufficient funds), **none** of the statements will be applied.

If you want capacity metrics:

```bash
aws dynamodb execute-transaction --cli-input-json file://txn.json --return-consumed-capacity TOTAL
```

---

### ✅ SDK v3 (Node.js) Example

```js
import {
  DynamoDBClient,
  ExecuteTransactionCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function transferFunds(fromUserId, toUserId, amount) {
  const cmd = new ExecuteTransactionCommand({
    TransactStatements: [
      {
        Statement:
          "UPDATE Accounts SET balance = balance - ? WHERE userId = ? IF balance >= ?",
        Parameters: [
          { N: amount.toString() },
          { S: fromUserId },
          { N: amount.toString() },
        ],
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      },
      {
        Statement: "UPDATE Accounts SET balance = balance + ? WHERE userId = ?",
        Parameters: [{ N: amount.toString() }, { S: toUserId }],
      },
      {
        Statement:
          "INSERT INTO Transactions VALUE {'txnId': ?, 'from': ?, 'to': ?, 'amount': ?}",
        Parameters: [
          { S: "txn-" + Date.now() },
          { S: fromUserId },
          { S: toUserId },
          { N: amount.toString() },
        ],
      },
    ],
    ReturnConsumedCapacity: "TOTAL",
  });

  try {
    const result = await client.send(cmd);
    console.log("Transaction succeeded, capacity:", result.ConsumedCapacity);
  } catch (err) {
    console.error("Transaction failed:", err);
    // inspect err.name === "TransactionCanceledException", err.CancellationReasons, etc.
    throw err;
  }
}
```

Key things to handle:

- Errors are thrown if any statement fails (e.g., conditional check fails, insufficient capacity)
- You can inspect `CancellationReasons` (in error) to see which part failed
- Use idempotency (client request token) if re-sending transaction to avoid double execution

---

### ⚠️ Constraints, Limitations & Edge Cases

- Can't mix read and write statements in the same transaction (all statements must be reads or writes). ([AWS Documentation][1])
- The number of statements per transaction: up to **100** now (previously 25). ([Amazon Web Services, Inc.][2])
- The total payload size of a transaction is limited (e.g. 4 MB for items)
- No two statements in the same transaction may operate on the **same item (same primary key)**
- If any statement fails (e.g. conditional check fails, insufficient capacity, validation error), entire transaction fails — **atomic** rollback
- DynamoDB Streams do **not guarantee ordering** of stream records relative to transaction internal order. [from user experiences] ([Reddit][3])
- Use a **client request token** to ensure idempotency (prevent accidental double-execution)
- `EXISTS` in PartiQL can be used for conditional checks inside a read transaction (as a condition check equivalent). ([AWS Documentation][1])

---

### 🧠 Interview-Style Questions: `execute-transaction`

1. **Q:** What is the difference between `execute-transaction` and `batch-execute-statement`?
   **A:** `execute-transaction` provides **atomic**, all-or-nothing execution of multiple statements. `batch-execute-statement` executes statements independently; partial success is possible.

2. **Q:** Why can’t you mix read and write statements in `execute-transaction`?
   **A:** The API enforces that the statements must all be of the same type (all reads or all writes) to maintain consistency semantics. The only exception is using `EXISTS` as a condition check.

3. **Q:** How many statements can you include now?
   **A:** Up to 100 actions per transaction as of the 2022 update. ([Amazon Web Services, Inc.][2])

4. **Q:** What happens if one statement fails due to a failed condition?
   **A:** The entire transaction is rolled back; no changes are applied. You can use `ReturnValuesOnConditionCheckFailure` to fetch the existing attributes of the failed item.

5. **Q:** Can two statements in the same transaction act on the same item (same PK)?
   **A:** No — that is disallowed.

---

That covers `execute-transaction` in depth. Let’s move to the next commonly used command:

---

## 2. `transact-write-items`

While `execute-transaction` is the PartiQL way of running multi-statement atomic operations, `transact-write-items` is the native (non‑PartiQL) API for performing **atomic writes** (Put, Update, Delete, ConditionCheck) across multiple items and tables.

### 🧭 Purpose

- Group up to 100 (previously 25) write operations (Put, Update, Delete, ConditionCheck) into one atomic transaction.
- All of them succeed or fail together.
- More flexible for writes than PartiQL in some cases (you can express update expressions, condition expressions, attribute updates, etc.).
- Often used in systems requiring consistency across multiple items.

---

### 🔧 CLI Syntax & Options

```bash
aws dynamodb transact-write-items
  --transact-items <value>
  [--client-request-token <value>]
  [--return-consumed-capacity <value>]
  [--return-item-collection-metrics <value>]
  [--cli-input-json | --cli-input-yaml]
  [--generate-cli-skeleton <value>]
  [--debug]
  [--endpoint-url <value>]
  [--no-verify-ssl]
  [--no-paginate]
  [--output <value>]
  [--query <value>]
  [--profile <value>]
  [--region <value>]
```

Where `--transact-items` is an array of action objects. For example:

```json
[
  {
    "Put": {
      "TableName": "Accounts",
      "Item": { "userId": { "S": "u1" }, "balance": { "N": "500" } },
      "ConditionExpression": "attribute_not_exists(userId)"
    }
  },
  {
    "Update": {
      "TableName": "Accounts",
      "Key": { "userId": { "S": "u2" } },
      "UpdateExpression": "SET balance = balance + :inc",
      "ExpressionAttributeValues": {
        ":inc": { "N": "100" }
      }
    }
  }
]
```

---

### 🧪 CLI Example: Transaction with Put + Update

```bash
aws dynamodb transact-write-items \
  --transact-items '[
    {
      "Put": {
        "TableName": "Accounts",
        "Item": {
          "userId": { "S": "u3" },
          "balance": { "N": "1000" }
        },
        "ConditionExpression": "attribute_not_exists(userId)"
      }
    },
    {
      "Update": {
        "TableName": "Accounts",
        "Key": {
          "userId": { "S": "u1" }
        },
        "UpdateExpression": "SET balance = balance - :amt",
        "ExpressionAttributeValues": {
          ":amt": { "N": "200" }
        },
        "ConditionExpression": "balance >= :amt"
      }
    }
  ]'
```

You can also use `--client-request-token` to make it idempotent, and request `--return-consumed-capacity` or `--return-item-collection-metrics`.

---

### ✅ SDK v3 (Node.js) Example

```js
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function performTransaction() {
  const cmd = new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: "Accounts",
          Item: {
            userId: { S: "uX" },
            balance: { N: "500" },
          },
          ConditionExpression: "attribute_not_exists(userId)",
        },
      },
      {
        Update: {
          TableName: "Accounts",
          Key: { userId: { S: "uA" } },
          UpdateExpression: "SET balance = balance - :amt",
          ExpressionAttributeValues: { ":amt": { N: "200" } },
          ConditionExpression: "balance >= :amt",
        },
      },
    ],
  });

  try {
    const resp = await client.send(cmd);
    console.log("Transaction succeeded");
  } catch (err) {
    console.error("Transaction failed:", err);
    throw err;
  }
}
```

You can also specify `ReturnConsumedCapacity` and `ReturnItemCollectionMetrics` in the command params.

---

### ⚠️ Constraints & Edge Cases

- Max number of transaction items: **100** (updated limit). ([Amazon Web Services, Inc.][2])
- The aggregate size of items in the transaction cannot exceed 4 MB.
- All actions must target items in the **same AWS account and region** (cannot mix cross-region). ([000039.awsstudygroup.com][4])
- Two different actions in the same transaction cannot operate on the **same item (same primary key)**.
- If any operation fails (due to condition check, capacity, validation, etc.), **the whole transaction fails** — atomic.
- If using DynamoDB Streams, the order of stream records within a transaction is not guaranteed.
- Returns `TransactionCanceledException` on failure; you can inspect `CancellationReasons` to see which action failed and why.
- Using `client-request-token` helps make transaction idempotent (if you retry, the service will not re-execute).

---

### 🧠 Interview Questions: `transact-write-items`

1. **Q:** Why would you use `transact-write-items` over multiple `put-item` / `update-item` calls?
   **A:** Because `transact-write-items` ensures **atomicity** — either all operations succeed, or none do — which is essential for maintaining consistency across multiple items.

2. **Q:** What is the maximum number of write actions you can include?
   **A:** Up to 100 actions per transaction (after the 2022 update). ([Amazon Web Services, Inc.][2])

3. **Q:** Can you update multiple attributes or with complex expressions in `transact-write-items`?
   **A:** Yes — you can use `UpdateExpression`, `ExpressionAttributeValues`, `ConditionExpression`, etc., just like in `update-item`.

4. **Q:** How do you detect which action failed inside a transaction?
   **A:** The `TransactionCanceledException` includes a `CancellationReasons` array providing per-item reason (e.g., `ConditionalCheckFailed`, `ValidationError`, `None`) in the same order as `TransactItems`.

---

That covers `transact-write-items`. Next up:

---

## 3. `transact-get-items`

This command is the read counterpart: fetch multiple items atomically (consistent snapshot) in one call.

### 🧭 Purpose

- Allows you to retrieve up to 100 items in one atomic operation, guaranteeing **strong consistency** across those gets.
- Useful when you want to ensure that you read a consistent view from multiple items at once.

---

### 🔧 CLI Syntax

```bash
aws dynamodb transact-get-items
  --transact-items <value>
  [--return-consumed-capacity <value>]
  [--cli-input-json | --cli-input-yaml]
  [--generate-cli-skeleton <value>]
  [--debug]
  [--endpoint-url <value>]
  [--no-verify-ssl]
  [--no-paginate]
  [--output <value>]
  [--query <value>]
  [--profile <value>]
  [--region <value>]
```

`--transact-items` is an array of objects, each with a `Get` key:

```json
[
  {
    "Get": {
      "TableName": "Users",
      "Key": { "userId": { "S": "u1" } },
      "ProjectionExpression": "userId, name, balance"
    }
  },
  {
    "Get": {
      "TableName": "Accounts",
      "Key": { "userId": { "S": "u2" } }
    }
  }
]
```

---

### 🧪 CLI Example: Multiple Get

```bash
aws dynamodb transact-get-items \
  --transact-items '[
    {
      "Get": {
        "TableName": "Users",
        "Key": {
          "userId": { "S": "u1" }
        },
        "ProjectionExpression": "userId, name"
      }
    },
    {
      "Get": {
        "TableName": "Accounts",
        "Key": {
          "userId": { "S": "u2" }
        }
      }
    }
  ]'
```

Response:

```json
{
  "Responses": [
    {
      "Item": {
        "userId": { "S": "u1" },
        "name": { "S": "Alice" }
      }
    },
    {
      "Item": {
        "userId": { "S": "u2" },
        "balance": { "N": "300" }
      }
    }
  ],
  "ConsumedCapacity": [
    {
      "TableName": "Users",
      "CapacityUnits": ...
    },
    {
      "TableName": "Accounts",
      "CapacityUnits": ...
    }
  ]
}
```

---

### ✅ SDK v3 (Node.js) Example

```js
import {
  DynamoDBClient,
  TransactGetItemsCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function getMultiple() {
  const cmd = new TransactGetItemsCommand({
    TransactItems: [
      {
        Get: {
          TableName: "Users",
          Key: { userId: { S: "u1" } },
          ProjectionExpression: "userId, name",
        },
      },
      {
        Get: {
          TableName: "Accounts",
          Key: { userId: { S: "u2" } },
        },
      },
    ],
  });

  const resp = await client.send(cmd);
  console.log(resp.Responses); // array of results
}
```

You can also pass `ReturnConsumedCapacity`.

---

### ⚠️ Constraints & Edge Cases

- Max 100 items per call
- All items must be within the same AWS account and region
- The aggregate size must not exceed limits (total size)
- If any read fails (e.g. missing table, invalid key), the entire call fails
- No partial success — though for reads this is less problematic than writes
- Supports **strongly consistent reads** across items (which is stronger than individual get)

---

### 🧠 Interview Questions: `transact-get-items`

1. **Q:** Why use `transact-get-items` instead of multiple `get-item` calls?
   **A:** Because `transact-get-items` gives you an **atomic, consistent snapshot** read across multiple items, ensuring they reflect a single consistent state.

2. **Q:** Can you use filters in `transact-get-items`?
   **A:** No — `transact-get-items` is for **direct get by key**. You can use `ProjectionExpression` to limit attributes, but not filter logic.

3. **Q:** If one of the keys doesn’t exist, does the whole operation fail?
   **A:** No. The operation as a whole still succeeds; the missing item will return `{"Item": null}` in its position. (Unlike transactional writes, reads don’t “fail” for missing items.)

---

Now, next:

---

## 4. `query`

Probably one of the most frequently used read operations in DynamoDB, `query` allows you to fetch items by **partition key** (and optionally sort key conditions), efficiently.

### 🧭 Purpose

- Fetch items from a table (or index) based on the **partition key** (and optionally a range condition on the sort key), without scanning the whole table.
- Supports filters, projections, sorting, pagination.
- Much more efficient than `scan` when you know the partition key.

---

### 🔧 CLI Syntax

```bash
aws dynamodb query
  --table-name <value>
  --key-condition-expression <value>
  [--index-name <value>]
  [--expression-attribute-names <value>]
  [--expression-attribute-values <value>]
  [--filter-expression <value>]
  [--projection-expression <value>]
  [--scan-index-forward | --no-scan-index-forward]
  [--limit <value>]
  [--consistent-read | --no-consistent-read]
  [--exclusive-start-key <value>]
  [--return-consumed-capacity <value>]
  [--cli-input-json | ...]
  [--debug]
  [--no-paginate]
  [--output]
  [--query <value>]
  [--profile]
  [--region]
```

---

### 🧪 CLI Example 1: Simple Query

Assume table `Orders` with partition key `customerId` and sort key `orderDate`.

```bash
aws dynamodb query \
  --table-name Orders \
  --key-condition-expression "customerId = :cid" \
  --expression-attribute-values '{":cid":{"S":"cust123"}}'
```

This returns all orders for `cust123`, in ascending sort key order (by default).

---

### 🧪 CLI Example 2: Query with sort key condition, filter, projection

```bash
aws dynamodb query \
  --table-name Orders \
  --key-condition-expression "customerId = :cid AND orderDate BETWEEN :start AND :end" \
  --expression-attribute-values '{":cid":{"S":"cust123"},":start":{"S":"2025-01-01"},":end":{"S":"2025-06-30"}}' \
  --filter-expression "status = :st" \
  --expression-attribute-values '{":st":{"S":"SHIPPED"}}' \
  --projection-expression "orderId, total, status" \
  --scan-index-forward false \
  --limit 10
```

**Notes**:

- `key-condition-expression` is mandatory and defines the partition key and optional sort key conditions
- `filter-expression` works after fetching items; it does _not_ reduce read capacity because the initial fetch still happens
- `scan-index-forward false` reverses order (descending sort key)
- `limit` limits number of matching items returned (not number of items scanned)
- Pagination: use `--exclusive-start-key` to continue from last result

---

### ✅ SDK v3 (Node.js) Example

```js
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function getRecentOrders(customerId, start, end) {
  const cmd = new QueryCommand({
    TableName: "Orders",
    KeyConditionExpression:
      "customerId = :cid AND orderDate BETWEEN :start AND :end",
    ExpressionAttributeValues: {
      ":cid": { S: customerId },
      ":start": { S: start },
      ":end": { S: end },
    },
    ProjectionExpression: "orderId, total, status, orderDate",
    ScanIndexForward: false,
    Limit: 5,
    ConsistentRead: false,
  });
  const resp = await client.send(cmd);
  if (resp.Items) {
    return resp.Items.map((i) => unmarshall(i));
  }
  return [];
}
```

Pagination:

```js
let lastKey = undefined;
do {
  const resp = await client.send(
    new QueryCommand({
      TableName: "Orders",
      KeyConditionExpression: "...",
      ExpressionAttributeValues: {
        /* ... */
      },
      ExclusiveStartKey: lastKey,
      Limit: 10,
    })
  );
  // process resp.Items
  lastKey = resp.LastEvaluatedKey;
} while (lastKey);
```

---

### ⚠️ Constraints & Edge Cases

- You **must** specify a partition key in `key-condition-expression`. You cannot query without knowing the partition key.
- Sort key conditions are optional (`=`, `<`, `>`, `BETWEEN`, `begins_with`, etc.).
- `filter-expression` filters after retrieving items — it does _not_ reduce cost on the server side.
- If result set is large, pagination kicks in (1 MB of data or limit).
- `scan-index-forward` controls sort order.
- `consistent-read` is optional; default is eventual consistency (except for global secondary indexes, which don’t support strong consistency).
- Be careful with attribute names reserved words — use `ExpressionAttributeNames` to alias.
- Index queries: specify `--index-name` when querying a GSI/LSI.

---

### 🧠 Interview Questions: `query`

1. **Q:** Why is `query` more efficient than `scan`?
   **A:** Because `query` uses the partition key to jump directly to relevant items, whereas `scan` reads the entire table (or index), consuming much more read throughput.

2. **Q:** Can you query on a non-key attribute?
   **A:** No — only attributes that are part of the key (partition or sort key). For other attributes, you'd need a GSI or use `scan`.

3. **Q:** Does `filter-expression` reduce read capacity costs?
   **A:** No — filtering happens after data is fetched, so capacity cost is based on read before filtering.

4. **Q:** How do you get results in descending order?
   **A:** Use `ScanIndexForward = false` (or CLI `--no-scan-index-forward`) to reverse the sort key order.

---

Next command:

---

## 5. `scan`

`scan` reads every item in a table (or index) and returns the data (optionally filtered). It’s powerful but expensive; use only when necessary.

### 🧭 Purpose

- When you don’t know the partition key (or you want a full table read), `scan` lets you retrieve all items, possibly filtered.
- Good for administrative tasks, data exports, analytics, etc.

---

### 🔧 CLI Syntax

```bash
aws dynamodb scan
  --table-name <value>
  [--index-name <value>]
  [--filter-expression <value>]
  [--expression-attribute-names <value>]
  [--expression-attribute-values <value>]
  [--projection-expression <value>]
  [--limit <value>]
  [--segment <value> --total-segments <value>]   # for parallel scan
  [--consistent-read | --no-consistent-read]
  [--exclusive-start-key <value>]
  [--return-consumed-capacity <value>]
  [--cli-input-json | ...]
  [--debug]
  [--no-paginate]
  [--output]
  [--query <value>]
  [--profile]
  [--region]
```

---

### 🧪 CLI Example: Simple Scan

```bash
aws dynamodb scan --table-name Users
```

---

### 🧪 CLI Example: Filtered Scan and Projection

```bash
aws dynamodb scan \
  --table-name Users \
  --filter-expression "active = :act" \
  --expression-attribute-values '{":act":{"BOOL":true}}' \
  --projection-expression "userId, name" \
  --limit 50
```

You can also do parallel scans:

```bash
aws dynamodb scan \
  --table-name Users \
  --segment 0 \
  --total-segments 4
```

Divide `total-segments` across threads to speed scan.

---

### ✅ SDK v3 (Node.js) Example

```js
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function scanActiveUsers() {
  const cmd = new ScanCommand({
    TableName: "Users",
    FilterExpression: "active = :act",
    ExpressionAttributeValues: { ":act": { BOOL: true } },
    ProjectionExpression: "userId, name",
    Limit: 20,
    ConsistentRead: false,
  });
  const resp = await client.send(cmd);
  if (resp.Items) {
    return resp.Items.map((i) => unmarshall(i));
  }
  return [];
}
```

For pagination:

```js
let lastKey = undefined;
do {
  const resp = await client.send(
    new ScanCommand({
      TableName: "Users",
      FilterExpression: "active = :act",
      ExpressionAttributeValues: { ":act": { BOOL: true } },
      ExclusiveStartKey: lastKey,
      Limit: 100,
    })
  );
  // process resp.Items
  lastKey = resp.LastEvaluatedKey;
} while (lastKey);
```

For parallel scan, you’d run multiple scans with different `Segment` values.

---

### ⚠️ Constraints & Caveats

- Very expensive — reads the entire dataset (or index)
- Filtering does not reduce read cost — filters are applied after the read
- Max 1 MB data processed per call — use pagination
- Use `Limit` to reduce data returned, but still cost is according to data scanned
- Parallel scan helps throughput but still expensive
- Strong consistency: you can specify `--consistent-read`, but for GSIs it's not supported

---

### 🧠 Interview Questions: `scan`

1. **Q:** When is using `scan` appropriate (versus `query`)?
   **A:** When you don’t know the partition key, or you need to read the entire table for analytics, admin tasks, backups, etc.

2. **Q:** Does `filter-expression` in scan save capacity?
   **A:** No — filtering happens after read, so cost is based on items scanned, not filtered.

3. **Q:** How do you parallelize a scan?
   **A:** Use `segment` and `total-segments` parameters to divide the table into portions scanned in parallel.

---

Moving on:

---

## 6. Basic CRUD: `put-item`, `get-item`, `update-item`, `delete-item`

These are the simplest, foundational operations in DynamoDB. Almost every application uses these.

### A. `put-item`

#### 🧭 Purpose

- Insert a new item or replace an existing item (overwrite)
- Optionally use a condition expression to perform the put only if certain conditions are met (for example, only if the item doesn’t already exist)

#### 🔧 CLI Syntax

```bash
aws dynamodb put-item
  --table-name <value>
  --item <value>
  [--condition-expression <value>]
  [--expression-attribute-names <value>]
  [--expression-attribute-values <value>]
  [--return-consumed-capacity <value>]
  [--return-item-collection-metrics <value>]
  [--cli-input-json | ...]
  [--debug]
  ...
```

#### 🧪 CLI Example

```bash
aws dynamodb put-item \
  --table-name Users \
  --item '{"userId":{"S":"u1"}, "name":{"S":"Alice"}, "active":{"BOOL":true}}'
```

With a condition:

```bash
aws dynamodb put-item \
  --table-name Users \
  --item '{"userId":{"S":"u2"}, "name":{"S":"Bob"}}' \
  --condition-expression "attribute_not_exists(userId)"
```

#### ✅ SDK v3 (Node.js)

```js
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function putUser(user) {
  const cmd = new PutItemCommand({
    TableName: "Users",
    Item: {
      userId: { S: user.userId },
      name: { S: user.name },
      active: { BOOL: user.active },
    },
    ConditionExpression: "attribute_not_exists(userId)",
  });
  await client.send(cmd);
}
```

---

### B. `get-item`

#### 🧭 Purpose

- Retrieve a single item by its primary key (partition key, and sort key if applicable)
- Optionally specify consistent read, projection expression, etc.

#### 🔧 CLI Syntax

```bash
aws dynamodb get-item
  --table-name <value>
  --key <value>
  [--projection-expression <value>]
  [--expression-attribute-names <value>]
  [--consistent-read | --no-consistent-read]
  [--return-consumed-capacity <value>]
  [--cli-input-json | ...]
  [--debug]
  ...
```

#### 🧪 CLI Example

```bash
aws dynamodb get-item \
  --table-name Users \
  --key '{"userId":{"S":"u1"}}'
```

With projection and strong consistency:

```bash
aws dynamodb get-item \
  --table-name Users \
  --key '{"userId":{"S":"u2"}}' \
  --projection-expression "name,active" \
  --consistent-read
```

#### ✅ SDK v3 (Node.js)

```js
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function getUser(userId) {
  const cmd = new GetItemCommand({
    TableName: "Users",
    Key: { userId: { S: userId } },
    ProjectionExpression: "userId, name, active",
    ConsistentRead: false,
  });
  const resp = await client.send(cmd);
  if (resp.Item) {
    return unmarshall(resp.Item);
  }
  return null;
}
```

---

### C. `update-item`

#### 🧭 Purpose

- Modify one or more attributes of an existing item
- Can use `UpdateExpression`, add/subtract numeric attributes, set/remove attributes, conditional expressions, etc.

#### 🔧 CLI Syntax

```bash
aws dynamodb update-item
  --table-name <value>
  --key <value>
  --update-expression <value>
  [--condition-expression <value>]
  [--expression-attribute-names <value>]
  [--expression-attribute-values <value>]
  [--return-values <value>]
  [--return-consumed-capacity <value>]
  [--return-item-collection-metrics <value>]
  [--cli-input-json | ...]
  [--debug]
  ...
```

`--return-values` can be `NONE`, `ALL_OLD`, `UPDATED_OLD`, `ALL_NEW`, `UPDATED_NEW`.

#### 🧪 CLI Example

```bash
aws dynamodb update-item \
  --table-name Users \
  --key '{"userId":{"S":"u1"}}' \
  --update-expression "SET name = :nm, active = :ac" \
  --expression-attribute-values '{":nm":{"S":"AliceUpdated"}, ":ac":{"BOOL":false}}' \
  --return-values UPDATED_NEW
```

With condition:

```bash
aws dynamodb update-item \
  --table-name Users \
  --key '{"userId":{"S":"u2"}}' \
  --update-expression "SET active = :ac" \
  --expression-attribute-values '{":ac":{"BOOL":true}}' \
  --condition-expression "attribute_exists(userId)"
```

#### ✅ SDK v3 (Node.js)

```js
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function setActive(userId, isActive) {
  const cmd = new UpdateItemCommand({
    TableName: "Users",
    Key: { userId: { S: userId } },
    UpdateExpression: "SET active = :ac",
    ExpressionAttributeValues: { ":ac": { BOOL: isActive } },
    ReturnValues: "UPDATED_NEW",
  });
  const resp = await client.send(cmd);
  return resp.Attributes; // returned attributes in DynamoDB JSON form
}
```

---

### D. `delete-item`

#### 🧭 Purpose

- Remove an item from a table by primary key
- Optionally conditional delete (delete only if condition holds), return old item, etc.

#### 🔧 CLI Syntax

```bash
aws dynamodb delete-item
  --table-name <value>
  --key <value>
  [--condition-expression <value>]
  [--expression-attribute-names <value>]
  [--expression-attribute-values <value>]
  [--return-values <value>]
  [--return-consumed-capacity <value>]
  [--return-item-collection-metrics <value>]
  [--cli-input-json | ...]
  [--debug]
...
```

`--return-values` can be `ALL_OLD`, `NONE`.

#### 🧪 CLI Example

```bash
aws dynamodb delete-item \
  --table-name Users \
  --key '{"userId":{"S":"u1"}}'
```

With condition and return:

```bash
aws dynamodb delete-item \
  --table-name Users \
  --key '{"userId":{"S":"u2"}}' \
  --condition-expression "attribute_exists(userId)" \
  --return-values ALL_OLD
```

#### ✅ SDK v3 (Node.js)

```js
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function deleteUser(userId) {
  const cmd = new DeleteItemCommand({
    TableName: "Users",
    Key: { userId: { S: userId } },
    ReturnValues: "ALL_OLD",
  });
  const resp = await client.send(cmd);
  if (resp.Attributes) {
    return unmarshall(resp.Attributes);
  }
  return null;
}
```

---

### 🧠 Interview Questions: CRUD operations

1. **Q:** When would you use `ConditionExpression` in a `put-item` or `delete-item`?
   **A:** To ensure write/delete only happens if certain conditions hold (e.g. item doesn’t exist, or some attribute is equal). Helps avoid overwriting or deleting unintentionally.

2. **Q:** What do `ReturnValues` options do in `update-item` / `delete-item`?
   **A:** They control whether the old or new attributes are returned (or none). E.g. `ALL_OLD` returns the full item state before deletion, `UPDATED_NEW` returns only updated attributes after update.

3. **Q:** If you `delete-item` for an item that doesn’t exist, will it error?
   **A:** No — delete is idempotent; deleting a non-existent item is a no-op, unless a condition expression fails.

---

Finally:

---

## 7. `batch-write-item` / `batch-get-item`

Batch operations let you operate on up to 25 items per request (non-transactional).

### A. `batch-write-item`

#### 🧭 Purpose

- Perform multiple `put-item` and `delete-item` operations in one call (non-atomic).
- Faster throughput and fewer network round-trips.

#### 🔧 CLI Syntax

```bash
aws dynamodb batch-write-item
  --request-items <value>
  [--return-consumed-capacity <value>]
  [--return-item-collection-metrics <value>]
  [--cli-input-json | ...]
  [--debug]
...
```

`--request-items` is a map of table names to arrays of write requests:

```json
{
  "Users": [
    {
      "PutRequest": {
        "Item": { "userId": { "S": "u1" }, "name": { "S": "Alice" } }
      }
    },
    { "DeleteRequest": { "Key": { "userId": { "S": "u2" } } } }
  ],
  "Orders": [
    {
      "PutRequest": {
        "Item": { "orderId": { "S": "o1" }, "amount": { "N": "100" } }
      }
    }
  ]
}
```

#### 🧪 CLI Example

```bash
aws dynamodb batch-write-item \
  --request-items '{
    "Users":[
      {"PutRequest":{"Item":{"userId":{"S":"u3"},"name":{"S":"Charlie"}}}},
      {"DeleteRequest":{"Key":{"userId":{"S":"u4"}}}}
    ],
    "Orders":[
      {"PutRequest":{"Item":{"orderId":{"S":"ord1"},"amount":{"N":"250"}}}}
    ]
  }'
```

Unprocessed items may be returned in `UnprocessedItems` — you should retry them.

#### ✅ SDK v3 (Node.js)

```js
import {
  DynamoDBClient,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function batchOps() {
  const cmd = new BatchWriteItemCommand({
    RequestItems: {
      Users: [
        {
          PutRequest: {
            Item: { userId: { S: "u5" }, name: { S: "Eve" } },
          },
        },
      ],
      Orders: [
        {
          DeleteRequest: {
            Key: { orderId: { S: "ord2" } },
          },
        },
      ],
    },
  });
  const resp = await client.send(cmd);
  if (resp.UnprocessedItems && Object.keys(resp.UnprocessedItems).length > 0) {
    // retry these
  }
}
```

---

### B. `batch-get-item`

#### 🧭 Purpose

- Fetch up to 100 (or 25?) items from one or more tables by key in one call (non-transactional).
- More efficient than multiple `get-item` calls.

#### 🔧 CLI Syntax

```bash
aws dynamodb batch-get-item
  --request-items <value>
  [--projection-expression <value>]
  [--expression-attribute-names <value>]
  [--return-consumed-capacity <value>]
  [--cli-input-json | ...]
  [--debug]
...
```

`--request-items` is a map of table names to objects with `Keys` and optional `ProjectionExpression`.

```json
{
  "Users": {
    "Keys": [{ "userId": { "S": "u1" } }, { "userId": { "S": "u2" } }],
    "ProjectionExpression": "userId, name"
  },
  "Orders": {
    "Keys": [{ "orderId": { "S": "ord1" } }]
  }
}
```

#### 🧪 CLI Example

```bash
aws dynamodb batch-get-item \
  --request-items '{
    "Users":{
      "Keys":[
        {"userId":{"S":"u1"}},
        {"userId":{"S":"u2"}}
      ],
      "ProjectionExpression":"userId, name"
    },
    "Orders":{
      "Keys":[{"orderId":{"S":"ord1"}}]
    }
  }'
```

Again, unprocessed keys may be returned (retry logic needed).

#### ✅ SDK v3 (Node.js)

```js
import { DynamoDBClient, BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function batchGet() {
  const cmd = new BatchGetItemCommand({
    RequestItems: {
      Users: {
        Keys: [{ userId: { S: "u1" } }, { userId: { S: "u2" } }],
        ProjectionExpression: "userId, name",
      },
      Orders: {
        Keys: [{ orderId: { S: "ord1" } }],
      },
    },
  });
  const resp = await client.send(cmd);
  const output = {};
  if (resp.Responses) {
    for (const table in resp.Responses) {
      output[table] = resp.Responses[table].map((item) => unmarshall(item));
    }
  }
  if (resp.UnprocessedKeys) {
    // retry logic
  }
  return output;
}
```

---

### 🧠 Interview Questions: Batch Operations

1. **Q:** Why do you need to handle `UnprocessedItems` or `UnprocessedKeys`?
   **A:** Because DynamoDB may throttle or not process all operations in one batch. The response will include which items were unprocessed and you must retry them.

2. **Q:** Are batch operations atomic?
   **A:** No. They are not transactional — some operations may succeed while others fail.

3. **Q:** What is the limit on number of items in `batch-write-item` or `batch-get-item`?
   **A:** For `batch-write-item`, you can request up to 25 `PutRequest` or `DeleteRequest` per table; for `batch-get-item`, up to 100 items (but per-request limits apply).

---

## ✅ Summary & Advice

We’ve now covered **the most commonly used DynamoDB commands** with full detail:

- `execute-transaction`
- `transact-write-items`
- `transact-get-items`
- `query`
- `scan`
- `put-item` / `get-item` / `update-item` / `delete-item`
- `batch-write-item` / `batch-get-item`

If you like, I can also prepare:

- A **cheat sheet** comparing all commands in one table
- A list of **common pitfalls** in real-world usage
- A set of **mock interview problems** you can practice with these APIs
