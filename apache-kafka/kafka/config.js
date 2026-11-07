import { Kafka } from "kafkajs";

export const TOPIC = "booking-created";
export const DLQ_TOPIC = "booking-created.dlq";
export const PARTITIONS = 3;

export function createKafka(clientId) {
  return new Kafka({ clientId, brokers: ["localhost:9094"] });
}
