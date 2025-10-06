import { app } from "./app.mjs";

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
    console.log(`Server is running http://${HOST}:${PORT}`);
})