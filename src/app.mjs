import cors from 'cors';
import "dotenv/config";
import express from 'express';
import { errorHandler } from './middleware/error-handler.mjs';
import { healthCheck } from './middleware/health-check.mjs';

// app instance
const app = express();

// middleware
app.use(cors({ origin: "*" }))
app.use(express.json());
app.use(express.urlencoded({ extended: true }))

// routes
app.get("/api/v1/health", healthCheck)


// Error-handling middleware
app.use(errorHandler);
export { app };

