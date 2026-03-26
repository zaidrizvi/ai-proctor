import Batch from "../models/Batch.js";

export const getBatches = async (_req, res) => {
  try {
    const batches = await Batch.find({ isActive: true }).sort({ name: 1 });
    res.json(batches);
  } catch (error) {
    console.error("Get batches error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const createBatch = async (req, res) => {
  try {
    const name = req.body.name?.trim();

    if (!name) {
      return res.status(400).json({ message: "Batch name is required" });
    }

    const duplicate = await Batch.findOne({ name }).collation({ locale: "en", strength: 2 });
    if (duplicate) {
      return res.status(400).json({ message: "Batch already exists" });
    }

    const batch = await Batch.create({
      name,
      createdBy: req.user?._id || null,
    });

    res.status(201).json(batch);
  } catch (error) {
    console.error("Create batch error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
