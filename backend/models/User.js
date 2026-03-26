import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false, // never sent in queries by default
    },
    role: {
      type: String,
      enum: ["admin", "student"],
      default: "student",
    },
    batch: {
      type: String,
      default: "",
      trim: true,
    },
    profilePic: {
      type: String,
      default: "",
    },
    // for face recognition — we store the registered face image path
    faceImagePath: {
      type: String,
      default: "",
    },
    faceEmbedding: {
      type: [Number],
      default: undefined,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});
// method to compare password at login
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;
