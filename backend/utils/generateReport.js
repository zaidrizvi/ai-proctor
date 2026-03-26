import PDFDocument from "pdfkit";

const dataUrlToBuffer = (value) => {
  if (typeof value !== "string" || !value.startsWith("data:image/")) {
    return null;
  }

  const parts = value.split(",");
  if (parts.length < 2) {
    return null;
  }

  try {
    return Buffer.from(parts[1], "base64");
  } catch {
    return null;
  }
};

const getSessionStatusLabel = (session) => {
  if (session?.status === "ongoing") return "IN PROGRESS";
  if (session?.status === "terminated") return "TERMINATED";
  if (session?.status === "abandoned") return "ABANDONED";
  return session?.passed ? "PASSED" : "FAILED";
};

const generatePDFReport = (data) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    const leftMargin = doc.page.margins.left;

    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const { student, exam, session, events } = data;

    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .fillColor("#000000")
      .text("AIProctor - Exam Report", { align: "center" });

    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#666666")
      .text(`Generated on: ${new Date().toLocaleString()}`, { align: "center" });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    doc.fillColor("#000000").fontSize(14).font("Helvetica-Bold").text("Student Information");
    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica");
    doc.text(`Name:     ${student.name}`);
    doc.text(`Email:    ${student.email}`);
    doc.text(`Exam:     ${exam.title}`);
    doc.text(`Subject:  ${exam.subject}`);
    doc.text(`Duration: ${exam.duration} minutes`);

    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("Result Summary");
    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica");
    doc.text(
      `Score:           ${
        session.status === "ongoing"
          ? `In Progress / ${exam.questions.length}`
          : `${session.score} / ${exam.questions.length}`
      }`
    );
    doc.text(`Percentage:      ${session.status === "ongoing" ? "-" : `${session.percentage}%`}`);
    doc.text(`Status:          ${getSessionStatusLabel(session)}`);
    doc.text(`Started At:      ${new Date(session.startedAt).toLocaleString()}`);
    doc.text(
      `Submitted At:    ${
        session.submittedAt ? new Date(session.submittedAt).toLocaleString() : "-"
      }`
    );

    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("Proctoring Summary");
    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica");
    doc.text(`Suspicion Score:       ${session.suspicionScore} / 100`);
    doc.text(`Total Flagged Events:  ${session.flaggedEventsCount}`);
    doc.text(`Tab Switches:          ${session.tabSwitchCount}`);
    doc.text(`Face Not Detected:     ${session.faceNotDetectedCount} times`);
    doc.text(`Session Status:        ${session.status.toUpperCase()}`);

    doc.moveDown(1);

    const referenceFaceBuffer = dataUrlToBuffer(student.faceImagePath);
    const verificationFaceBuffer = dataUrlToBuffer(session.verificationFaceImagePath);

    if (referenceFaceBuffer || verificationFaceBuffer) {
      doc.fontSize(14).font("Helvetica-Bold").text("Identity Images");
      doc.moveDown(0.5);

      const imageTop = doc.y;
      const imageWidth = 180;
      const imageHeight = 135;

      doc.fontSize(10).font("Helvetica-Bold").text("Registered Face", 50, imageTop);
      if (referenceFaceBuffer) {
        doc.image(referenceFaceBuffer, 50, imageTop + 16, { fit: [imageWidth, imageHeight] });
      } else {
        doc.fontSize(9).font("Helvetica").text("Not available", 50, imageTop + 20);
      }

      doc.fontSize(10).font("Helvetica-Bold").text("Exam Verification Face", 300, imageTop);
      if (verificationFaceBuffer) {
        doc.image(verificationFaceBuffer, 300, imageTop + 16, { fit: [imageWidth, imageHeight] });
      } else {
        doc.fontSize(9).font("Helvetica").text("Not available", 300, imageTop + 20);
      }

      doc.y = imageTop + imageHeight + 28;
      doc.moveDown(1);
    }

    if (events && events.length > 0) {
      if (doc.y > doc.page.height - 180) {
        doc.addPage();
      }

      doc.x = leftMargin;
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("Flagged Events Timeline", leftMargin, doc.y, {
          align: "left",
        });
      doc.moveDown(0.5);

      events.forEach((event) => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const severity = event.severity.toUpperCase();
        const type = event.eventType.replace(/_/g, " ").toUpperCase();

        if (doc.y > doc.page.height - 70) {
          doc.addPage();
        }

        doc.x = leftMargin;

        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor(
            event.severity === "high"
              ? "#cc0000"
              : event.severity === "medium"
              ? "#cc6600"
              : "#666600"
          )
          .text(`[${time}] [${severity}] ${type}`, leftMargin, doc.y, {
            align: "left",
          });

        if (event.description) {
          doc
            .font("Helvetica")
            .fillColor("#444444")
            .fontSize(9)
            .text(`   ${event.description}`, leftMargin, doc.y, {
              align: "left",
            });
        }

        doc.moveDown(0.3);
      });
    } else {
      doc.x = leftMargin;
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor("#000000")
        .text("No flagged events recorded.", leftMargin, doc.y, {
          align: "left",
        });
    }

    doc.moveDown(1);
    doc.fillColor("#000000");
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor("#999999")
      .text("This report was auto-generated by AIProctor.", { align: "center" });

    doc.end();
  });
};

export default generatePDFReport;
