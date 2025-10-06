export function healthCheck(req, res, next) {
    res.status(200).json({
        message: "Server is healthy",
        version: "1.0.0",
        pid: process.pid,
    })
}