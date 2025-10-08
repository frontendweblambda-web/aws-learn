import bcrypt from 'bcryptjs';

export const Password = {
    /**
     * Hash password
     * @param {String} password
     * @return {Promise<String>}  
     */
    async hash(password) {
        const salt = await bcrypt.genSalt(12)
        return await bcrypt.hash(password, salt);
    },

    /**
     * Compare password
     * @param {String} password 
     * @param {String} hash 
     */
    async compare(password, hash) {
        return await bcrypt.compare(password, hash)
    }
}