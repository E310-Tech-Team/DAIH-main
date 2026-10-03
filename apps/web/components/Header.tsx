"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPortalBookingUrl } from "../lib/config";

export const Header: React.FC<{ isTransparent?: boolean }> = ({
  isTransparent = true,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSubnav, setOpenSubnav] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Listen to scroll position for desktop header transition
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 40) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu and subnav on route change
  useEffect(() => {
    setMobileOpen(false);
    setOpenSubnav(null);
  }, [pathname]);

  const isHome = pathname === "/";
  const isTopTransparent = mounted
    ? isTransparent && isHome && !scrolled
    : isTransparent && (!pathname || pathname === "/");

  const closeMenu = () => {
    setMobileOpen(false);
    setOpenSubnav(null);
  };

  const toggleSubnav = (name: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setOpenSubnav((prev) => (prev === name ? null : name));
  };

  const headerClassNames = [
    isTopTransparent && !mobileOpen
      ? "desktop-header-top transparent"
      : "desktop-header-scrolled header-light smaller",
    scrolled ? "is-scrolled" : "",
    mobileOpen ? "mobile-menu-active header-light" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header suppressHydrationWarning className={headerClassNames}>
      <div className="container" suppressHydrationWarning>
        <div className="row" suppressHydrationWarning>
          <div className="col-md-12" suppressHydrationWarning>
            <div className="de-flex" suppressHydrationWarning>
              <div className="de-flex-col" suppressHydrationWarning>
                <div className="de-flex-col" suppressHydrationWarning>
                  {/* logo begin */}
                  <div
                    id="logo"
                    suppressHydrationWarning
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: "100%",
                      padding: "8px 0",
                    }}
                  >
                    <Link
                      href="/"
                      onClick={closeMenu}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        textDecoration: "none",
                      }}
                    >
                      <img
                        alt="DAIH logo"
                        className="logo header-logo-img"
                        src="/images/logo-light.png"
                      />
                      <img
                        alt="DAIH logo"
                        className="logo-2 header-logo-img"
                        src="/images/logo.png"
                      />
                    </Link>
                  </div>
                  {/* logo close */}
                </div>
                <div className="de-flex-col"></div>
              </div>

              <div
                className="de-flex-col header-col-mid"
                suppressHydrationWarning
              >
                {/* mainmenu begin */}
                <ul
                  id="mainmenu"
                  suppressHydrationWarning
                  className={mobileOpen ? "open" : ""}
                >
                  <li>
                    <Link href="/" onClick={closeMenu}>
                      Home<span></span>
                    </Link>
                  </li>

                  <li>
                    <Link href="/our-plans" onClick={closeMenu}>
                      Our Plans<span></span>
                    </Link>
                  </li>

                  <li
                    className={`menu-has-subnav ${openSubnav === "daih" ? "subnav-open" : ""}`}
                  >
                    {/* Desktop view link */}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                      }}
                      className="desktop-nav-link d-none d-lg-inline-flex align-items-center"
                    >
                      DAIH
                      <svg
                        className="desktop-dropdown-chevron"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          marginLeft: "6px",
                          display: "inline-block",
                          verticalAlign: "middle",
                          transition: "transform 0.2s ease",
                        }}
                      >
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </a>

                    {/* Mobile view row */}
                    <div
                      className="mobile-subnav-row d-flex d-lg-none"
                      onClick={(e) => toggleSubnav("daih", e)}
                      role="button"
                      tabIndex={0}
                    >
                      <span>DAIH</span>
                      <span
                        className={`mobile-subnav-chevron ${openSubnav === "daih" ? "rotated" : ""}`}
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </span>
                    </div>

                    <ul
                      className={`subnav-dropdown ${openSubnav === "daih" ? "is-open" : ""}`}
                    >
                      <li>
                        <Link href="/about-us" onClick={closeMenu}>
                          About Us
                        </Link>
                      </li>
                      <li>
                        <Link href="/news" onClick={closeMenu}>
                          News
                        </Link>
                      </li>
                      <li>
                        <Link href="/jobs" onClick={closeMenu}>
                          Jobs
                        </Link>
                      </li>
                      <li>
                        <Link href="/contact" onClick={closeMenu}>
                          Contact
                        </Link>
                      </li>
                    </ul>
                  </li>

                  <li>
                    <Link href="/events" onClick={closeMenu}>
                      Events<span></span>
                    </Link>
                  </li>

                  <li>
                    <Link href="/gallery" onClick={closeMenu}>
                      Gallery<span></span>
                    </Link>
                  </li>

                  {/* Book A Space CTA Button for Mobile */}
                  <li
                    className="mobile-menu-cta-item d-block d-lg-none"
                    style={{
                      padding: "16px 20px 12px 20px",
                      borderBottom: "none",
                      borderTop: "none",
                      background: "transparent",
                      listStyle: "none",
                      textAlign: "center",
                    }}
                  >
                    <a
                      href={getPortalBookingUrl()}
                      className="mobile-menu-book-btn"
                      onClick={closeMenu}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "100%",
                        backgroundColor: "#220563",
                        color: "#ffffff",
                        padding: "11px 18px",
                        borderRadius: "999px",
                        fontSize: "13.5px",
                        fontWeight: 700,
                        textDecoration: "none",
                        boxShadow: "0 4px 16px rgba(34, 5, 99, 0.35)",
                        textAlign: "center",
                        cursor: "pointer",
                        margin: "0 auto",
                      }}
                    >
                      <div
                        className="mobile-cta-content"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto",
                          color: "#ffffff",
                          fontWeight: 700,
                          fontSize: "13.5px",
                          textAlign: "center",
                        }}
                      >
                        <i
                          className="fa fa-calendar"
                          style={{
                            marginRight: "8px",
                            color: "#ffffff",
                            fontSize: "15px",
                            display: "inline-block",
                          }}
                        ></i>
                        Book A Space
                      </div>
                    </a>
                  </li>
                </ul>
              </div>

              <div className="de-flex-col" suppressHydrationWarning>
                <div className="menu_side_area" suppressHydrationWarning>
                  {/* Button shown ONLY on desktop (>= 992px), hidden on mobile */}
                  <a
                    href={getPortalBookingUrl()}
                    className="btn-main header-book-btn d-none d-lg-inline-flex"
                  >
                    <i className="fa fa-calendar mr-2"></i>
                    <span>Book A Space</span>
                  </a>

                  {/* Mobile Action Buttons: Calendar + Hamburger (Side-by-side, ONLY on mobile) */}
                  <div className="mobile-header-actions d-flex d-lg-none align-items-center">
                    <a
                      href={getPortalBookingUrl()}
                      className="mobile-header-cal-btn"
                      aria-label="Book a Space"
                      title="Book a Space"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <rect
                          x="3.5"
                          y="4.5"
                          width="17"
                          height="16"
                          rx="2.5"
                          stroke="white"
                          strokeWidth="2"
                        />
                        <line
                          x1="8"
                          y1="2.5"
                          x2="8"
                          y2="5.5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="16"
                          y1="2.5"
                          x2="16"
                          y2="5.5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="3.5"
                          y1="9.5"
                          x2="20.5"
                          y2="9.5"
                          stroke="white"
                          strokeWidth="2"
                        />
                        <rect
                          x="7"
                          y="12"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                        <rect
                          x="11"
                          y="12"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                        <rect
                          x="15"
                          y="12"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                        <rect
                          x="7"
                          y="15.5"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                        <rect
                          x="11"
                          y="15.5"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                        <rect
                          x="15"
                          y="15.5"
                          width="2"
                          height="2"
                          rx="0.4"
                          fill="white"
                        />
                      </svg>
                    </a>

                    <button
                      type="button"
                      className={`mobile-header-hamburger-btn ${mobileOpen ? "open" : ""}`}
                      aria-label="Toggle navigation menu"
                      onClick={() => setMobileOpen(!mobileOpen)}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <line
                          x1="2"
                          y1="4.5"
                          x2="18"
                          y2="4.5"
                          stroke="white"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="2"
                          y1="10"
                          x2="18"
                          y2="10"
                          stroke="white"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="2"
                          y1="15.5"
                          x2="18"
                          y2="15.5"
                          stroke="white"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
