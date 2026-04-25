export type VitalsField = "heartRate" | "temperature" | "bloodPressure" | "height" | "weight";

export type PatientVitals = Record<VitalsField, string>;

export type ReceptionPatient = {
  id: string;
  doctorId: string;
  firstName: string;
  lastName: string;
  age: number;
  gender: "Male" | "Female" | "Other";
  tokenNumber: number;
  visitType: string;
  note: string;
  initials: string;
  timelineTime: string;
};

export type ReadyPatient = {
  id: string;
  name: string;
  initials: string;
  statusLabel: string;
};

export type ServingPatient = {
  id: string;
  name: string;
  doctorLine: string;
  clockLabel: string;
};

export type DoctorOption = {
  id: string;
  name: string;
  room: string | null;
};
