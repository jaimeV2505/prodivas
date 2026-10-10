import { createRoot } from "react-dom/client";
import BookingFlow from "@/components/BookingFlow";
import EasyBooking from "@/components/EasyBooking";
import Hero from "@/components/Hero";
import ReschedulePicker from "@/components/ReschedulePicker";
import WaitlistForm from "@/components/WaitlistForm";

const cfg = (window as unknown as { __AUDIT__: { component: string; props: Record<string, unknown> } }).__AUDIT__;
const map: Record<string, React.ComponentType<any>> = { booking: BookingFlow, easy: EasyBooking, hero: Hero, resched: ReschedulePicker, waitlist: WaitlistForm };
const C = map[cfg.component];
createRoot(document.getElementById("root")!).render(<C {...cfg.props} />);
