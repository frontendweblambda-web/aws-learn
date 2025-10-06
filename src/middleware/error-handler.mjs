// errorHandler.mjs
export function errorHandler(error, req, res, next) {
    res.status(500).json({
        error: {
            message: error.message,
        },
    });
}