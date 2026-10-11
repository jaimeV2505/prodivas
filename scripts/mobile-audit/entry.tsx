import { createRoot } from "react-dom/client";
import AddToBooking from "@/components/AddToBooking";
import BookingFlow from "@/components/BookingFlow";
import EasyBooking from "@/components/EasyBooking";
import Hero from "@/components/Hero";
import ReschedulePicker from "@/components/ReschedulePicker";
import OptoutButton from "@/components/OptoutButton";
import ResponseButtons from "@/components/ResponseButtons";
import ReviewForm from "@/components/ReviewForm";
import WaitlistForm from "@/components/WaitlistForm";

const cfg = (window as unknown as { __AUDIT__: { component: string; props: Record<string, unknown> } }).__AUDIT__;
const map: Record<string, React.ComponentType<any>> = { booking: BookingFlow, easy: EasyBooking, hero: Hero, resched: ReschedulePicker, waitlist: WaitlistForm, response: ResponseButtons, review: ReviewForm, optout: OptoutButton, addto: AddToBooking };
const C = map[cfg.component];
createRoot(document.getElementById("root")!).render(<C {...cfg.props} />);
