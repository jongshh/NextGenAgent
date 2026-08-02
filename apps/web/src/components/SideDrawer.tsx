import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

interface SideDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SideDrawer({ open, title, onClose, children }: SideDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="drawer-backdrop"
            aria-label={`${title} 닫기`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="side-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 310, damping: 34 }}
          >
            <header>
              <h2>{title}</h2>
              <button type="button" onClick={onClose} aria-label={`${title} 닫기`}>
                <X size={20} />
              </button>
            </header>
            <div className="drawer-content">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

