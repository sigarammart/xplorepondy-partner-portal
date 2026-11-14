import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CarFront, CheckCircle2, CircleAlert, Edit3, Bike, LoaderCircle, Plus, RefreshCw, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createRentalVehicle, deleteRentalVehicle, fetchRentalMedia, fetchRentalVehicles, uploadRentalMedia, updateRentalVehicle, type RentalMediaItem, type RentalVehicle } from "@/lib/rentals";

type RentalForm = {
  vehicleType: "bicycle" | "bike" | "car";
  bikeSubtype: "scooter" | "e-scooter" | "bike" | "e-bike";
  brand: string; model: string; variant: string; registrationYear: string;
  fuelType: string; transmission: string; engineCc: string; seatingCapacity: string;
  hasAc: boolean; helmetsIncluded: boolean; description: string;
  pricePerHour: string; pricePerDay: string; pricePerWeekday: string; pricePerWeekend: string; pricePerWeek: string; securityDeposit: string;
  minimumDurationHours: string; pickupLocation: string; deliveryAvailable: boolean; deliveryCharge: string;
  featuredImageUrl: string; gallery: string;
};


type RentalPreset = Omit<RentalForm, "registrationYear" | "pickupLocation" | "featuredImageUrl" | "gallery" | "description"> & {
  id: string;
  label: string;
  note: string;
};

const rentalPresets: RentalPreset[] = [
  { id: "bicycle-standard", label: "Standard Bicycle", note: "City / heritage cycling", vehicleType: "bicycle", brand: "Generic", model: "Standard Bicycle", variant: "", fuelType: "Pedal", transmission: "Standard", engineCc: "", seatingCapacity: "1", hasAc: false, helmetsIncluded: true, pricePerHour: "50", pricePerDay: "250", pricePerWeekday: "250", pricePerWeekend: "250", pricePerWeek: "1200", securityDeposit: "500", minimumDurationHours: "4", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bicycle-mtb", label: "Mountain Bicycle", note: "Geared / MTB", vehicleType: "bicycle", brand: "Generic", model: "Mountain Bicycle", variant: "MTB", fuelType: "Pedal", transmission: "Geared", engineCc: "", seatingCapacity: "1", hasAc: false, helmetsIncluded: true, pricePerHour: "80", pricePerDay: "400", pricePerWeekday: "400", pricePerWeekend: "400", pricePerWeek: "2000", securityDeposit: "800", minimumDurationHours: "4", deliveryAvailable: false, deliveryCharge: "" },
    { id: "bike-activa-6g", label: "Honda Activa 6G", note: "Popular scooter", vehicleType: "bike", brand: "Honda", model: "Activa 6G", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "100", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-jupiter", label: "TVS Jupiter", note: "Comfort scooter", vehicleType: "bike", brand: "TVS", model: "Jupiter", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "100", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-access-125", label: "Suzuki Access 125", note: "125cc scooter", vehicleType: "bike", brand: "Suzuki", model: "Access 125", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "550", pricePerWeekday: "550", pricePerWeekend: "550", pricePerWeek: "3000", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-rayzr-125", label: "Yamaha RayZR 125", note: "Lightweight scooter", vehicleType: "bike", brand: "Yamaha", model: "RayZR 125", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "550", pricePerWeekday: "550", pricePerWeekend: "550", pricePerWeek: "3000", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-shine-125", label: "Honda Shine 125", note: "Commuter bike", vehicleType: "bike", brand: "Honda", model: "Shine 125", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "550", pricePerWeekday: "550", pricePerWeekend: "550", pricePerWeek: "3000", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-apache-160", label: "TVS Apache RTR 160", note: "Performance bike", vehicleType: "bike", brand: "TVS", model: "Apache RTR 160", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "160", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "150", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-fzs", label: "Yamaha FZ-S FI", note: "Street bike", vehicleType: "bike", brand: "Yamaha", model: "FZ-S FI", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "150", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "150", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-pulsar-150", label: "Bajaj Pulsar 150", note: "Popular commuter", vehicleType: "bike", brand: "Bajaj", model: "Pulsar 150", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "150", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "150", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-pulsar-n160", label: "Bajaj Pulsar N160", note: "Sport commuter", vehicleType: "bike", brand: "Bajaj", model: "Pulsar N160", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "160", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "160", pricePerDay: "750", pricePerWeekday: "750", pricePerWeekend: "750", pricePerWeek: "4000", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-xtreme-125r", label: "Hero Xtreme 125R", note: "Sport commuter", vehicleType: "bike", brand: "Hero", model: "Xtreme 125R", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "140", pricePerDay: "650", pricePerWeekday: "650", pricePerWeekend: "650", pricePerWeek: "3500", securityDeposit: "1800", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-classic-350", label: "Royal Enfield Classic 350", note: "Touring favourite", vehicleType: "bike", brand: "Royal Enfield", model: "Classic 350", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "350", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "250", pricePerDay: "1200", pricePerWeekday: "1200", pricePerWeekend: "1200", pricePerWeek: "6500", securityDeposit: "3000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-hunter-350", label: "Royal Enfield Hunter 350", note: "Urban roadster", vehicleType: "bike", brand: "Royal Enfield", model: "Hunter 350", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "350", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "250", pricePerDay: "1200", pricePerWeekday: "1200", pricePerWeekend: "1200", pricePerWeek: "6500", securityDeposit: "3000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-bullet-350", label: "Royal Enfield Bullet 350", note: "Classic cruiser", vehicleType: "bike", brand: "Royal Enfield", model: "Bullet 350", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "350", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "250", pricePerDay: "1200", pricePerWeekday: "1200", pricePerWeekend: "1200", pricePerWeek: "6500", securityDeposit: "3000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-meteor-350", label: "Royal Enfield Meteor 350", note: "Cruiser bike", vehicleType: "bike", brand: "Royal Enfield", model: "Meteor 350", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "350", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "275", pricePerDay: "1300", pricePerWeekday: "1300", pricePerWeekend: "1300", pricePerWeek: "7000", securityDeposit: "3500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-dio", label: "Honda Dio", note: "City scooter", vehicleType: "bike", brand: "Honda", model: "Dio", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "100", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-fascino-125", label: "Yamaha Fascino 125", note: "Retro scooter", vehicleType: "bike", brand: "Yamaha", model: "Fascino 125", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "550", pricePerWeekday: "550", pricePerWeekend: "550", pricePerWeek: "3000", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-ntorq-125", label: "TVS Ntorq 125", note: "Sport scooter", vehicleType: "bike", brand: "TVS", model: "Ntorq 125", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "130", pricePerDay: "600", pricePerWeekday: "600", pricePerWeekend: "600", pricePerWeek: "3200", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-unicorn-160", label: "Honda Unicorn 160", note: "Comfort commuter", vehicleType: "bike", brand: "Honda", model: "Unicorn 160", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "160", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "150", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-r15", label: "Yamaha R15", note: "Sport motorcycle", vehicleType: "bike", brand: "Yamaha", model: "R15", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "155", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "250", pricePerDay: "1200", pricePerWeekday: "1200", pricePerWeekend: "1200", pricePerWeek: "6500", securityDeposit: "3000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-dominar-400", label: "Bajaj Dominar 400", note: "Touring motorcycle", vehicleType: "bike", brand: "Bajaj", model: "Dominar 400", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "400", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "300", pricePerDay: "1600", pricePerWeekday: "1600", pricePerWeekend: "1600", pricePerWeek: "8500", securityDeposit: "4000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "bike-yamaha-zr", label: "Yamaha ZR", note: "Scooter", vehicleType: "bike", brand: "Yamaha", model: "ZR", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "550", pricePerWeekday: "550", pricePerWeekend: "550", pricePerWeek: "3000", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-aerox-155", label: "Yamaha Aerox", note: "Sport scooter", vehicleType: "bike", brand: "Yamaha", model: "Aerox 155", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "155", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-aviator", label: "Honda Aviator", note: "City scooter", vehicleType: "bike", brand: "Honda", model: "Aviator", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-cliq", label: "Honda Cliq", note: "City scooter", vehicleType: "bike", brand: "Honda", model: "Cliq", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-navi", label: "Honda Navi", note: "Compact motorcycle", vehicleType: "bike", brand: "Honda", model: "Navi", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-maestro", label: "Hero Maestro", note: "Comfort scooter", vehicleType: "bike", brand: "Hero", model: "Maestro", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-vespa-125", label: "Vespa 125", note: "Premium scooter", vehicleType: "bike", brand: "Vespa", model: "125", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "650", pricePerWeekday: "650", pricePerWeekend: "650", pricePerWeek: "3500", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-avenger", label: "Bajaj Avenger", note: "Cruiser motorcycle", vehicleType: "bike", brand: "Bajaj", model: "Avenger", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "160", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "800", pricePerWeekday: "800", pricePerWeekend: "800", pricePerWeek: "4500", securityDeposit: "2500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-piaggio-vespa", label: "Piaggio Vespa", note: "Premium scooter", vehicleType: "bike", brand: "Piaggio", model: "Vespa", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "125", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "650", pricePerWeekday: "650", pricePerWeekend: "650", pricePerWeek: "3500", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-scooty-zest", label: "Scooty Zest", note: "Lightweight scooter", vehicleType: "bike", brand: "TVS", model: "Scooty Zest", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "110", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "500", pricePerWeekday: "500", pricePerWeekend: "500", pricePerWeek: "2800", securityDeposit: "1500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-ktm", label: "KTM", note: "Performance motorcycle", vehicleType: "bike", brand: "KTM", model: "KTM", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "200", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "900", pricePerWeekday: "900", pricePerWeekend: "900", pricePerWeek: "5000", securityDeposit: "2500", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "bike-tvs-apache", label: "TVS Apache", note: "Performance bike", vehicleType: "bike", brand: "TVS", model: "Apache", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "160", seatingCapacity: "2", hasAc: false, helmetsIncluded: true, pricePerHour: "120", pricePerDay: "700", pricePerWeekday: "700", pricePerWeekend: "700", pricePerWeek: "3800", securityDeposit: "2000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
  { id: "car-swift", label: "Maruti Suzuki Swift", note: "Compact hatchback", vehicleType: "car", brand: "Maruti Suzuki", model: "Swift", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "250", pricePerDay: "1800", pricePerWeekday: "1800", pricePerWeekend: "1800", pricePerWeek: "10000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-wagonr", label: "Maruti Suzuki Wagon R", note: "City hatchback", vehicleType: "car", brand: "Maruti Suzuki", model: "Wagon R", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "250", pricePerDay: "1800", pricePerWeekday: "1800", pricePerWeekend: "1800", pricePerWeek: "10000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-dzire", label: "Maruti Suzuki Dzire", note: "Compact sedan", vehicleType: "car", brand: "Maruti Suzuki", model: "Dzire", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "275", pricePerDay: "2000", pricePerWeekday: "2000", pricePerWeekend: "2000", pricePerWeek: "11000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-baleno", label: "Maruti Suzuki Baleno", note: "Premium hatchback", vehicleType: "car", brand: "Maruti Suzuki", model: "Baleno", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "275", pricePerDay: "2000", pricePerWeekday: "2000", pricePerWeekend: "2000", pricePerWeek: "11000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-i20", label: "Hyundai i20", note: "Premium hatchback", vehicleType: "car", brand: "Hyundai", model: "i20", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "300", pricePerDay: "2200", pricePerWeekday: "2200", pricePerWeekend: "2200", pricePerWeek: "12000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-i10-nios", label: "Hyundai Grand i10 Nios", note: "Compact city car", vehicleType: "car", brand: "Hyundai", model: "Grand i10 Nios", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "275", pricePerDay: "2000", pricePerWeekday: "2000", pricePerWeekend: "2000", pricePerWeek: "11000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-venue", label: "Hyundai Venue", note: "Compact SUV", vehicleType: "car", brand: "Hyundai", model: "Venue", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "350", pricePerDay: "2600", pricePerWeekday: "2600", pricePerWeekend: "2600", pricePerWeek: "14000", securityDeposit: "7000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-punch", label: "Tata Punch", note: "Compact SUV", vehicleType: "car", brand: "Tata", model: "Punch", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "325", pricePerDay: "2400", pricePerWeekday: "2400", pricePerWeekend: "2400", pricePerWeek: "13000", securityDeposit: "6000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-nexon", label: "Tata Nexon", note: "Compact SUV", vehicleType: "car", brand: "Tata", model: "Nexon", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "350", pricePerDay: "2600", pricePerWeekday: "2600", pricePerWeekend: "2600", pricePerWeek: "14000", securityDeposit: "7000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-glanza", label: "Toyota Glanza", note: "Premium hatchback", vehicleType: "car", brand: "Toyota", model: "Glanza", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "300", pricePerDay: "2200", pricePerWeekday: "2200", pricePerWeekend: "2200", pricePerWeek: "12000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-ertiga", label: "Maruti Suzuki Ertiga", note: "7-seater MPV", vehicleType: "car", brand: "Maruti Suzuki", model: "Ertiga", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1500", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "400", pricePerDay: "3000", pricePerWeekday: "3000", pricePerWeekend: "3000", pricePerWeek: "16000", securityDeposit: "8000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-creta", label: "Hyundai Creta", note: "Mid-size SUV", vehicleType: "car", brand: "Hyundai", model: "Creta", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1500", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "425", pricePerDay: "3200", pricePerWeekday: "3200", pricePerWeekend: "3200", pricePerWeek: "17500", securityDeposit: "8000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-seltos", label: "Kia Seltos", note: "Mid-size SUV", vehicleType: "car", brand: "Kia", model: "Seltos", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1500", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "450", pricePerDay: "3300", pricePerWeekday: "3300", pricePerWeekend: "3300", pricePerWeek: "18000", securityDeposit: "8000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-innova", label: "Toyota Innova Crysta", note: "Premium 7-seater", vehicleType: "car", brand: "Toyota", model: "Innova Crysta", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "2400", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "550", pricePerDay: "4500", pricePerWeekday: "4500", pricePerWeekend: "4500", pricePerWeek: "24000", securityDeposit: "10000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  
    { id: "car-scorpio", label: "Mahindra Scorpio", note: "Full-size SUV", vehicleType: "car", brand: "Mahindra", model: "Scorpio", variant: "", fuelType: "Diesel", transmission: "Manual", engineCc: "2200", seatingCapacity: "7", hasAc: true, helmetsIncluded: false, pricePerHour: "500", pricePerDay: "2800", pricePerWeekday: "2800", pricePerWeekend: "2800", pricePerWeek: "15000", securityDeposit: "10000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "car-xuv500", label: "Mahindra XUV500", note: "7-seater SUV", vehicleType: "car", brand: "Mahindra", model: "XUV500", variant: "", fuelType: "Diesel", transmission: "Manual", engineCc: "2200", seatingCapacity: "7", hasAc: true, helmetsIncluded: false, pricePerHour: "450", pricePerDay: "2600", pricePerWeekday: "2600", pricePerWeekend: "2600", pricePerWeek: "14000", securityDeposit: "9000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "car-city", label: "Honda City", note: "Premium sedan", vehicleType: "car", brand: "Honda", model: "City", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1500", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "325", pricePerDay: "2300", pricePerWeekday: "2300", pricePerWeekend: "2300", pricePerWeek: "12500", securityDeposit: "6000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "car-amaze", label: "Honda Amaze", note: "Compact sedan", vehicleType: "car", brand: "Honda", model: "Amaze", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1200", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "275", pricePerDay: "2000", pricePerWeekday: "2000", pricePerWeekend: "2000", pricePerWeek: "11000", securityDeposit: "5000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "car-brezza", label: "Maruti Suzuki Brezza", note: "Compact SUV", vehicleType: "car", brand: "Maruti Suzuki", model: "Brezza", variant: "", fuelType: "Petrol", transmission: "Manual", engineCc: "1500", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "350", pricePerDay: "2500", pricePerWeekday: "2500", pricePerWeekend: "2500", pricePerWeek: "13500", securityDeposit: "7000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
  { id: "car-fortuner", label: "Toyota Fortuner", note: "Premium SUV", vehicleType: "car", brand: "Toyota", model: "Fortuner", variant: "", fuelType: "Petrol", transmission: "Automatic", engineCc: "2800", seatingCapacity: "5", hasAc: true, helmetsIncluded: false, pricePerHour: "800", pricePerDay: "6500", pricePerWeekday: "6500", pricePerWeekend: "6500", pricePerWeek: "35000", securityDeposit: "15000", minimumDurationHours: "24", deliveryAvailable: false, deliveryCharge: "" },
];

const emptyForm: RentalForm = {
  vehicleType: "bicycle", bikeSubtype: "bike", brand: "", model: "", variant: "", registrationYear: "",
  fuelType: "", transmission: "", engineCc: "", seatingCapacity: "", hasAc: false, helmetsIncluded: false,
  description: "", pricePerHour: "", pricePerDay: "", pricePerWeekday: "", pricePerWeekend: "", pricePerWeek: "", securityDeposit: "",
  minimumDurationHours: "24", pickupLocation: "", deliveryAvailable: false, deliveryCharge: "",
  featuredImageUrl: "", gallery: "",
};

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function toForm(vehicle: RentalVehicle): RentalForm {
  return {
    vehicleType: vehicle.vehicle_type, bikeSubtype: vehicle.bike_subtype || "bike", brand: vehicle.brand, model: vehicle.model, variant: vehicle.variant,
    registrationYear: vehicle.registration_year ? String(vehicle.registration_year) : "",
    fuelType: vehicle.fuel_type, transmission: vehicle.transmission, engineCc: vehicle.engine_cc ? String(vehicle.engine_cc) : "",
    seatingCapacity: vehicle.seating_capacity ? String(vehicle.seating_capacity) : "",
    hasAc: vehicle.has_ac, helmetsIncluded: vehicle.helmets_included, description: vehicle.description,
    pricePerHour: vehicle.price_per_hour != null ? String(vehicle.price_per_hour) : "",
    pricePerDay: String(vehicle.price_per_day ?? ""), pricePerWeekday: String(vehicle.price_per_weekday ?? vehicle.price_per_day ?? ""), pricePerWeekend: String(vehicle.price_per_weekend ?? vehicle.price_per_day ?? ""), pricePerWeek: vehicle.price_per_week != null ? String(vehicle.price_per_week) : "",
    securityDeposit: String(vehicle.security_deposit ?? ""), minimumDurationHours: String(vehicle.minimum_duration_hours ?? 24),
    pickupLocation: vehicle.pickup_location, deliveryAvailable: vehicle.delivery_available, deliveryCharge: String(vehicle.delivery_charge ?? ""),
    featuredImageUrl: vehicle.featured_image_url, gallery: vehicle.gallery.join("\n"),
  };
}

export function RentalVehiclesManager({ email, identityToken, isAdministrator = false }: { email?: string; identityToken?: string; isAdministrator?: boolean }) {
  const identity = { email, identityToken };
  const [vehicles, setVehicles] = useState<RentalVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "bicycle" | "bike" | "car">("all");
  const [quickAddTab, setQuickAddTab] = useState<"bicycle" | "bike" | "car">("bicycle");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RentalVehicle | null>(null);
  const [form, setForm] = useState<RentalForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [presetQueue, setPresetQueue] = useState<string[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<"featured" | "gallery">("featured");
  const [mediaItems, setMediaItems] = useState<RentalMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [formStatus, setFormStatus] = useState<"draft" | "active" | "inactive">("draft");

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await fetchRentalVehicles({ data: identity }) as { items?: RentalVehicle[] };
      setVehicles(result.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load rental vehicles.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [email, identityToken]);

  const filtered = useMemo(() => vehicles.filter((v) => typeFilter === "all" || v.vehicle_type === typeFilter), [vehicles, typeFilter]);

  function startNew(type: "bike" | "car") {
    setEditing(null);
    setForm({ ...emptyForm, vehicleType: type });
    setFormStatus("draft");
    setFormOpen(true);
  }

  function togglePreset(id: string) {
    setSelectedPresets((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function usePreset(id: string) {
    const preset = rentalPresets.find((item) => item.id === id);
    if (!preset) return;
    setEditing(null);
    setForm({
      ...emptyForm,
      vehicleType: preset.vehicleType,
      bikeSubtype: preset.vehicleType === "bike" ? (preset.note.toLowerCase().includes("scooter") ? "scooter" : "bike") : "bike",
      brand: preset.brand,
      model: preset.model,
      variant: preset.variant,
      fuelType: preset.fuelType,
      transmission: preset.transmission,
      engineCc: preset.engineCc,
      seatingCapacity: preset.seatingCapacity,
      hasAc: preset.hasAc,
      helmetsIncluded: preset.helmetsIncluded,
      pricePerHour: preset.pricePerHour,
      pricePerDay: preset.pricePerDay,
      pricePerWeekday: preset.pricePerWeekday,
      pricePerWeekend: preset.pricePerWeekend,
      pricePerWeek: preset.pricePerWeek,
      securityDeposit: preset.securityDeposit,
      minimumDurationHours: preset.minimumDurationHours,
      deliveryAvailable: preset.deliveryAvailable,
      deliveryCharge: preset.deliveryCharge,
    });
    setFormOpen(true);
  }

  function addSelectedPresets() {
    if (selectedPresets.length === 0) return;
    const [first, ...rest] = selectedPresets;
    setPresetQueue(rest);
    setSelectedPresets([]);
    usePreset(first);
  }

  async function openMediaPicker(mode: "featured" | "gallery") {
    setMediaPickerMode(mode);
    setMediaPickerOpen(true);
    setMediaSearch("");
    setMediaLoading(true);
    try {
      const result = await fetchRentalMedia({ data: { email, identityToken } }) as { items?: RentalMediaItem[] };
      setMediaItems(result.items ?? []);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not load WordPress media.");
    } finally {
      setMediaLoading(false);
    }
  }

  async function searchMedia() {
    setMediaLoading(true);
    try {
      const result = await fetchRentalMedia({ data: { email, identityToken, search: mediaSearch } }) as { items?: RentalMediaItem[] };
      setMediaItems(result.items ?? []);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not search WordPress media.");
    } finally {
      setMediaLoading(false);
    }
  }

  function selectMedia(item: RentalMediaItem) {
    if (mediaPickerMode === "featured") {
      setField("featuredImageUrl", item.url);
    } else {
      setForm((current) => {
        const urls = current.gallery.split("\n").map((value) => value.trim()).filter(Boolean);
        if (!urls.includes(item.url) && urls.length < 20) urls.push(item.url);
        return { ...current, gallery: urls.join("\n") };
      });
    }
    setMediaPickerOpen(false);
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image uploads are limited to 8 MB.");
      return;
    }

    setMediaUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const item = await uploadRentalMedia({
        data: { email, identityToken, filename: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64 },
      }) as RentalMediaItem;
      setMediaItems((current) => [item, ...current]);
      selectMedia(item);
      toast.success("Image uploaded to your WordPress Media Library.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not upload image.");
    } finally {
      setMediaUploading(false);
    }
  }

  function startEdit(vehicle: RentalVehicle) {
    setEditing(vehicle); setForm(toForm(vehicle)); setFormStatus(vehicle.status); setFormOpen(true);
  }

  function setField<K extends keyof RentalForm>(key: K, value: RentalForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const weekdayPrice = Number(form.pricePerWeekday || form.pricePerDay);
    const weekendPrice = Number(form.pricePerWeekend || form.pricePerDay);
    if (!form.brand.trim() || !form.model.trim() || !Number.isFinite(weekdayPrice) || weekdayPrice < 0 || !Number.isFinite(weekendPrice) || weekendPrice < 0) {
      setError("Brand, model and valid Mon–Thu and Fri–Sun rental prices are required.");
      return;
    }
    setSaving(true); setError("");
    const payload = {
      email, identityToken, vehicleType: form.vehicleType, bikeSubtype: form.vehicleType === "bike" ? form.bikeSubtype : undefined, brand: form.brand.trim(), model: form.model.trim(), variant: form.variant.trim(),
      registrationYear: form.registrationYear ? Number(form.registrationYear) : null,
      fuelType: form.fuelType.trim(), transmission: form.transmission.trim(), engineCc: form.engineCc ? Number(form.engineCc) : null,
      seatingCapacity: form.seatingCapacity ? Number(form.seatingCapacity) : null, hasAc: form.hasAc, helmetsIncluded: form.helmetsIncluded,
      description: form.description.trim(), pricePerHour: form.pricePerHour ? Number(form.pricePerHour) : null, pricePerDay: weekdayPrice,
      pricePerWeekday: weekdayPrice, pricePerWeekend: weekendPrice,
      pricePerWeek: form.pricePerWeek ? Number(form.pricePerWeek) : null, securityDeposit: form.securityDeposit ? Number(form.securityDeposit) : 0,
      minimumDurationHours: form.minimumDurationHours ? Number(form.minimumDurationHours) : 24, pickupLocation: form.pickupLocation.trim(),
      deliveryAvailable: form.deliveryAvailable, deliveryCharge: form.deliveryCharge ? Number(form.deliveryCharge) : 0,
      featuredImageUrl: form.featuredImageUrl.trim(), gallery: form.gallery.split("\n").map((s) => s.trim()).filter(Boolean),
      ...(isAdministrator && editing ? { status: formStatus } : {}),
    };
    try {
      const result = editing
        ? await updateRentalVehicle({ data: { ...payload, vehicleId: editing.id } })
        : await createRentalVehicle({ data: payload });
      const vehicle = result as RentalVehicle;
      setVehicles((current) => editing ? current.map((item) => item.id === editing.id ? vehicle : item) : [vehicle, ...current]);

      if (!editing && presetQueue.length > 0) {
        const [nextPreset, ...remainingPresets] = presetQueue;
        setPresetQueue(remainingPresets);
        usePreset(nextPreset);
        toast.success("Vehicle added for review. Next selected vehicle is ready.");
      } else {
        setFormOpen(false);
        setPresetQueue([]);
        toast.success(editing ? "Rental vehicle updated." : "Rental vehicle submitted for review.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save rental vehicle.");
    } finally { setSaving(false); }
  }

  async function changeVehicleStatus(vehicle: RentalVehicle, status: "draft" | "active" | "inactive") {
    setSaving(true); setError("");
    try {
      const updated = await updateRentalVehicle({ data: {
        email, identityToken, vehicleId: vehicle.id, vehicleType: vehicle.vehicle_type, bikeSubtype: vehicle.vehicle_type === "bike" ? (vehicle.bike_subtype || "bike") : undefined, brand: vehicle.brand, model: vehicle.model, vehicle.model,
        variant: vehicle.variant, registrationYear: vehicle.registration_year, fuelType: vehicle.fuel_type, transmission: vehicle.transmission,
        engineCc: vehicle.engine_cc, seatingCapacity: vehicle.seating_capacity, hasAc: vehicle.has_ac, helmetsIncluded: vehicle.helmets_included,
        description: vehicle.description, pricePerHour: vehicle.price_per_hour, pricePerDay: vehicle.price_per_day,
        pricePerWeekday: vehicle.price_per_weekday ?? vehicle.price_per_day, pricePerWeekend: vehicle.price_per_weekend ?? vehicle.price_per_day, pricePerWeek: vehicle.price_per_week,
        securityDeposit: vehicle.security_deposit, minimumDurationHours: vehicle.minimum_duration_hours, pickupLocation: vehicle.pickup_location,
        deliveryAvailable: vehicle.delivery_available, deliveryCharge: vehicle.delivery_charge, featuredImageUrl: vehicle.featured_image_url,
        gallery: vehicle.gallery, status,
      } }) as RentalVehicle;
      setVehicles((current) => current.map((item) => item.id === vehicle.id ? updated : item));
      toast.success(status === "active" ? "Rental vehicle approved and published." : status === "draft" ? "Rental vehicle returned to pending review." : "Rental vehicle deactivated.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update rental approval.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!deleteId) return;
    setSaving(true); setError("");
    try {
      await deleteRentalVehicle({ data: { email, identityToken, vehicleId: deleteId } });
      setVehicles((current) => current.filter((item) => item.id !== deleteId));
      setDeleteId(null);
      toast.success("Rental vehicle deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete rental vehicle.");
    } finally { setSaving(false); }
  }

  return (
    <section className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-border/70 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-3"><div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CarFront className="size-6" /></div><div><h2 className="font-display text-2xl font-semibold">Rental Vehicles</h2><p className="text-sm text-muted-foreground">Manage bikes and cars available for online rental.</p></div></div></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => startNew("bicycle")}><Plus className="mr-2 size-4" />Add bicycle</Button>
          <Button size="sm" variant="outline" onClick={() => startNew("car")}><Plus className="mr-2 size-4" />Add car</Button>
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-border/70 bg-muted/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Quick add vehicles</h3>
            <p className="mt-1 text-sm text-muted-foreground">Select the vehicles you have in your fleet. Each selected vehicle opens with suggested rental details that you can edit before submitting.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{selectedPresets.length} selected</span><button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelectedPresets([])}>Clear</button></div>
        </div>

        <div className="mt-5 grid grid-cols-3 rounded-2xl border border-border/70 bg-background/60 p-1" role="tablist" aria-label="Quick add vehicle type">
          {(["bicycle", "bike", "car"] as const).map((vehicleType) => {
            const count = rentalPresets.filter((preset) => preset.vehicleType === vehicleType).length;
            const active = quickAddTab === vehicleType;
            return (
              <button key={vehicleType} type="button" role="tab" aria-selected={active} onClick={() => setQuickAddTab(vehicleType)} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                {vehicleType === "car" ? <CarFront className="size-4" /> : <Bike className="size-4" />}
                {vehicleType === "bicycle" ? "Bicycles" : vehicleType === "bike" ? "Bikes" : "Cars"}
                <span className={active ? "text-primary-foreground/80" : "text-muted-foreground"}>({count})</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {rentalPresets.filter((preset) => preset.vehicleType === quickAddTab).map((preset) => {
            const selected = selectedPresets.includes(preset.id);
            return (
              <label key={preset.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border/70 bg-background hover:bg-muted"}`}>
                <input type="checkbox" className="sr-only" checked={selected} onChange={() => togglePreset(preset.id)} />
                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{selected && <Check className="size-3.5" />}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{preset.label}</span><span className="block text-xs text-muted-foreground">{preset.note}</span></span>
              </label>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <p className="text-xs text-muted-foreground">Need something else? Use <button type="button" className="font-medium text-primary hover:underline" onClick={() => startNew("bike")}>manual entry</button> to enter any bike or car.</p>
          <Button size="sm" disabled={selectedPresets.length === 0 || saving} onClick={addSelectedPresets}>
            <Plus className="mr-2 size-4" />Add selected
          </Button>
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["all", "bicycle", "bike", "car"] as const).map((type) => (
          <button key={type} type="button" onClick={() => setTypeFilter(type)} className={`rounded-full border px-4 py-2 text-sm font-medium transition ${typeFilter === type ? "border-primary bg-primary/10 text-primary" : "border-border/70 hover:bg-muted"}`}>
            {type === "all" ? "All vehicles" : type === "bicycle" ? "Bicycles" : type === "bike" ? "Bikes" : "Cars"} <span className="ml-1 text-xs text-muted-foreground">({type === "all" ? vehicles.length : vehicles.filter((v) => v.vehicle_type === type).length})</span>
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}

      {loading ? (
        <div className="mt-6 space-y-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="xp-skeleton h-28 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center"><CarFront className="mx-auto size-9 text-muted-foreground" /><h3 className="mt-3 font-semibold">No rental vehicles yet</h3><p className="mt-1 text-sm text-muted-foreground">Add your first bicycle, bike or car to start building your rental inventory.</p><div className="mt-4 flex justify-center gap-2"><Button onClick={() => startNew("bicycle")}><Bike className="mr-2 size-4" />Add bicycle</Button><Button variant="outline" onClick={() => startNew("bike")}><Bike className="mr-2 size-4" />Add bike</Button><Button variant="outline" onClick={() => startNew("car")}><CarFront className="mr-2 size-4" />Add car</Button></div></div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((vehicle) => (
            <article key={vehicle.id} className="overflow-hidden rounded-2xl border border-border/70 bg-background">
              <div className="relative aspect-[16/9] bg-muted">
                {vehicle.featured_image_url ? <img src={vehicle.featured_image_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground">{vehicle.vehicle_type === "car" ? <CarFront className="size-12" /> : <Bike className="size-12" />}</div>}
                <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold ${vehicle.status === "active" ? "bg-emerald-500 text-white" : vehicle.status === "inactive" ? "bg-slate-700 text-white" : "bg-amber-500 text-white"}`}>{vehicle.status === "draft" ? "Pending review" : vehicle.status}</span>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{vehicle.vehicle_type}</p><h3 className="mt-1 text-lg font-semibold">{vehicle.brand} {vehicle.model}</h3>{vehicle.variant && <p className="text-sm text-muted-foreground">{vehicle.variant}</p>}</div><div className="grid grid-cols-2 gap-3 text-right"><div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Mon–Thu</p><p className="font-bold text-primary">{money(vehicle.price_per_weekday)}</p></div><div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fri–Sun</p><p className="font-bold text-primary">{money(vehicle.price_per_weekend)}</p></div></div></div>
                {isAdministrator && <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs"><span className="font-semibold text-foreground">Owner:</span> {vehicle.owner_name || (vehicle.owner_user_id ? `User #${vehicle.owner_user_id}` : "Unknown owner")}</div>}
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>{vehicle.fuel_type || "Fuel —"}</span><span>{vehicle.transmission || "Transmission —"}</span><span>{vehicle.vehicle_type === "bicycle" ? "Bicycle" : vehicle.vehicle_type === "bike" && vehicle.engine_cc ? `${vehicle.engine_cc} cc` : vehicle.seating_capacity ? `${vehicle.seating_capacity} seats` : "Specs —"}</span><span>Deposit {money(vehicle.security_deposit)}</span></div>
                {isAdministrator && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 p-2">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">Approval</span>
                    <Button type="button" size="sm" variant={vehicle.status === "active" ? "default" : "outline"} disabled={saving} onClick={() => void changeVehicleStatus(vehicle, "active")}>Approve & publish</Button>
                    <Button type="button" size="sm" variant={vehicle.status === "draft" ? "default" : "outline"} disabled={saving} onClick={() => void changeVehicleStatus(vehicle, "draft")}>Pending review</Button>
                    <Button type="button" size="sm" variant={vehicle.status === "inactive" ? "default" : "outline"} disabled={saving} onClick={() => void changeVehicleStatus(vehicle, "inactive")}>Deactivate</Button>
                  </div>
                )}
                <div className="mt-4 flex gap-2"><Button size="sm" variant="outline" className="flex-1" onClick={() => startEdit(vehicle)}><Edit3 className="mr-1.5 size-4" />Edit</Button><Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(vehicle.id)}><Trash2 className="size-4" /></Button></div>
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 p-3 sm:p-6">
          <div className="mx-auto my-4 max-w-4xl rounded-3xl bg-card shadow-2xl ring-1 ring-border/70">
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{editing ? "Edit rental vehicle" : "New rental vehicle"}</p><h2 className="mt-1 text-xl font-semibold">{form.vehicleType === "bicycle" ? "Bicycle details" : form.vehicleType === "bike" ? "Bike details" : "Car details"}</h2></div><button type="button" onClick={() => setFormOpen(false)} className="rounded-full p-2 hover:bg-muted" aria-label="Close"><X className="size-5" /></button></div>
            <form onSubmit={(event) => void save(event)} className="space-y-6 p-5 sm:p-6">
              <section><h3 className="font-semibold">Vehicle type</h3><div className="mt-3"><div className="rounded-2xl border border-primary bg-primary/5 p-4 ring-1 ring-primary"><div className="flex items-center gap-3">{form.vehicleType === "car" ? <CarFront className="size-6 text-primary" /> : <Bike className="size-6 text-primary" />}<div><span className="block font-semibold">{form.vehicleType === "bicycle" ? "Bicycle" : form.vehicleType === "bike" ? "Bike" : "Car"}</span><span className="text-xs text-muted-foreground">{form.vehicleType === "bicycle" ? "Cycles and electric bicycles" : form.vehicleType === "bike" ? "Motorcycles and scooters" : "Cars and compact vehicles"}</span></div></div></div></div></section>
              <section><h3 className="font-semibold">Basic information</h3>{!isAdministrator && editing && <p className="mt-1 text-xs text-muted-foreground">Brand and model are fixed after submission because they determine the public vehicle grouping.</p>}<div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Brand *" value={form.brand} onChange={(v) => setField("brand", v)} placeholder="Royal Enfield" disabled={!isAdministrator && editing} /><Field label="Model *" value={form.model} onChange={(v) => setField("model", v)} placeholder="Classic 350" disabled={!isAdministrator && editing} /><Field label="Variant" value={form.variant} onChange={(v) => setField("variant", v)} placeholder="Signals / Standard" />{form.vehicleType === "bike" && <label className="block"><span className="mb-1.5 block text-sm font-medium">Bike category *</span><select value={form.bikeSubtype} onChange={(e) => setField("bikeSubtype", e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"><option value="scooter">Scooter</option><option value="e-scooter">E-Scooter</option><option value="bike">Bike</option><option value="e-bike">E-Bike</option></select></label>}<Field label="Registration year" type="number" value={form.registrationYear} onChange={(v) => setField("registrationYear", v)} placeholder="2024" /><Field label={form.vehicleType === "bicycle" ? "Drive type" : "Fuel type"} value={form.fuelType} onChange={(v) => setField("fuelType", v)} placeholder={form.vehicleType === "bicycle" ? "Pedal / Electric" : "Petrol / Electric / Diesel"} /><Field label="Transmission" value={form.transmission} onChange={(v) => setField("transmission", v)} placeholder="Manual / Automatic" /><Field label={form.vehicleType === "bicycle" ? "Wheel / frame type" : form.vehicleType === "bike" ? "Engine CC" : "Seating capacity"} type={form.vehicleType === "bicycle" ? "text" : "number"} value={form.vehicleType === "bicycle" ? form.transmission : form.vehicleType === "bike" ? form.engineCc : form.seatingCapacity} onChange={(v) => setField(form.vehicleType === "bicycle" ? "transmission" : form.vehicleType === "bike" ? "engineCc" : "seatingCapacity", v)} placeholder={form.vehicleType === "bicycle" ? "Standard / MTB / Electric" : form.vehicleType === "bike" ? "350" : "5"} />{form.vehicleType === "car" && <Field label="Engine CC" type="number" value={form.engineCc} onChange={(v) => setField("engineCc", v)} placeholder="1197" />}</div></section>
              <section><h3 className="font-semibold">Rental pricing</h3><p className="mt-1 text-xs text-muted-foreground">Set separate rates for weekdays (Mon–Thu) and weekends (Fri–Sun).</p><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Hourly price" type="number" value={form.pricePerHour} onChange={(v) => setField("pricePerHour", v)} placeholder="Optional" /><Field label="Mon–Thu price *" type="number" value={form.pricePerWeekday} onChange={(v) => setField("pricePerWeekday", v)} placeholder="500" /><Field label="Fri–Sun price *" type="number" value={form.pricePerWeekend} onChange={(v) => setField("pricePerWeekend", v)} placeholder="600" /><Field label="Weekly price" type="number" value={form.pricePerWeek} onChange={(v) => setField("pricePerWeek", v)} placeholder="Optional" /><Field label="Security deposit" type="number" value={form.securityDeposit} onChange={(v) => setField("securityDeposit", v)} placeholder="2000" /></div></section>
              <section><h3 className="font-semibold">Pickup & delivery</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Pickup location" value={form.pickupLocation} onChange={(v) => setField("pickupLocation", v)} placeholder="Heritage Town, Puducherry" /><Field label="Minimum rental hours" type="number" value={form.minimumDurationHours} onChange={(v) => setField("minimumDurationHours", v)} placeholder="24" /><label className="flex items-center gap-3 rounded-xl border border-border/70 p-3 text-sm"><input type="checkbox" checked={form.deliveryAvailable} onChange={(e) => setField("deliveryAvailable", e.target.checked)} />Delivery available</label>{form.deliveryAvailable && <Field label="Delivery charge" type="number" value={form.deliveryCharge} onChange={(v) => setField("deliveryCharge", v)} placeholder="200" />}</div></section>
              <section><h3 className="font-semibold">Vehicle features</h3><div className="mt-3 flex flex-wrap gap-3"><label className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm"><input type="checkbox" checked={form.helmetsIncluded} onChange={(e) => setField("helmetsIncluded", e.target.checked)} />Helmets included</label>{form.vehicleType === "car" && <label className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm"><input type="checkbox" checked={form.hasAc} onChange={(e) => setField("hasAc", e.target.checked)} />Air conditioning</label>}</div></section>
              {isAdministrator && editing && (
                <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <h3 className="font-semibold">Administrator approval</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Approve this vehicle to make it visible in the public rental catalogue.</p>
                  <select value={formStatus} onChange={(event) => setFormStatus(event.target.value as "draft" | "active" | "inactive")} className="mt-3 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm sm:max-w-sm">
                    <option value="draft">Pending review</option>
                    <option value="active">Approved & published</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </section>
              )}

              <section>
                <h3 className="font-semibold">Photos</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-border/70 p-3">
                    <label className="text-sm font-medium">Featured image</label>
                    {form.featuredImageUrl ? <img src={form.featuredImageUrl} alt="" className="mt-2 h-36 w-full rounded-lg object-cover" /> : <div className="mt-2 flex h-36 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">No featured image</div>}
                    <div className="mt-3 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void openMediaPicker("featured")}>Choose from Media Library</Button>
                      {form.featuredImageUrl && <Button type="button" size="sm" variant="ghost" onClick={() => setField("featuredImageUrl", "")}>Remove</Button>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/70 p-3">
                    <label className="text-sm font-medium">Gallery</label>
                    <div className="mt-2 flex min-h-36 flex-wrap gap-2 rounded-lg bg-muted p-2">
                      {form.gallery.split("\n").map((url) => url.trim()).filter(Boolean).map((url) => <img key={url} src={url} alt="" className="h-20 w-24 rounded-md object-cover" />)}
                      {!form.gallery.trim() && <span className="m-auto text-sm text-muted-foreground">No gallery images</span>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void openMediaPicker("gallery")}>Add from Media Library</Button>
                      {form.gallery.trim() && <Button type="button" size="sm" variant="ghost" onClick={() => setField("gallery", "")}>Clear</Button>}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Images are stored in the WordPress Media Library and saved with the rental vehicle as their media URLs.</p>
              </section>
              <section><h3 className="font-semibold">Description</h3><textarea value={form.description} onChange={(e) => setField("description", e.target.value)} rows={5} placeholder="Describe the vehicle, included items and rental conditions." className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></section>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}{editing ? "Save changes" : "Submit vehicle"}</Button></div>
            </form>
          </div>
        </div>
      )}

      {deleteId && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl ring-1 ring-border/70"><h3 className="text-lg font-semibold">Delete rental vehicle?</h3><p className="mt-2 text-sm text-muted-foreground">Vehicles with pending or confirmed bookings cannot be deleted. Deactivate them instead.</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button><Button variant="destructive" disabled={saving} onClick={() => void remove()}>{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}Delete</Button></div></div></div>}
      {mediaPickerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl ring-1 ring-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div><h3 className="font-semibold">{mediaPickerMode === "featured" ? "Choose featured image" : "Add gallery images"}</h3><p className="text-xs text-muted-foreground">Your WordPress Media Library images</p></div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setMediaPickerOpen(false)}><X className="size-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-border p-4">
              <input value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchMedia(); }} placeholder="Search media..." className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <Button type="button" variant="outline" onClick={() => void searchMedia()}>Search</Button>
              <label className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                {mediaUploading ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                Upload image
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={mediaUploading} onChange={(event) => void uploadMedia(event)} />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {mediaLoading ? <div className="flex min-h-48 items-center justify-center text-muted-foreground"><LoaderCircle className="mr-2 size-5 animate-spin" />Loading Media Library...</div> :
                mediaItems.length === 0 ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">No images found.</div> :
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {mediaItems.map((item) => (
                    <button type="button" key={item.id} onClick={() => selectMedia(item)} className="group overflow-hidden rounded-xl border border-border bg-background text-left hover:border-primary hover:ring-1 hover:ring-primary">
                      <img src={item.thumbnail_url} alt={item.title} className="aspect-square w-full object-cover" />
                      <span className="block truncate p-2 text-xs">{item.title || "Untitled"}</span>
                    </button>
                  ))}
                </div>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  return <label className="block text-sm"><span className="font-medium">{label}</span><input type={type} min={type === "number" ? "0" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} /></label>;
}
