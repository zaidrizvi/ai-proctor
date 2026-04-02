import mongoose from "mongoose";

const getMongoConnectionHint = (error) => {
  const message = error?.message || "";

  if (!process.env.MONGO_URI) {
    return "Set MONGO_URI in backend/.env before starting the API.";
  }

  if (message.includes("querySrv ETIMEOUT")) {
    return "The Atlas SRV DNS lookup timed out. Check your internet/DNS settings or replace the mongodb+srv URI with a direct mongodb:// seedlist URI.";
  }

  if (
    message.includes("IP whitelist") ||
    message.includes("ECONNREFUSED") ||
    message.includes("EACCES") ||
    message.includes("ReplicaSetNoPrimary")
  ) {
    return "MongoDB Atlas is reachable by hostname, but the cluster is rejecting or blocking the connection. Verify Atlas Network Access and confirm your current IP is allowed.";
  }

  return "Verify the MongoDB URI, credentials, and Atlas network access settings.";
};

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    console.error(`Hint: ${getMongoConnectionHint(error)}`);
    throw error;
  }
};

export default connectDB;
