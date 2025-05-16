import mongoose from "mongoose"

const passwordResetSchema = new mongoose.Schema({
    email: {
        type: String,
        required: false,
        unique: true,
        trim: true,
        lowercase: true,
    },
    token: {
        type: String,
        unique: true,
        required: true
    },
    expires: {
        type: Date,
        required: true
    },
    phoneNumber : {
        type: String,
        required: false
    }

});

export const passwordResetTokenModel = mongoose.model("passwordResetToken", passwordResetSchema);