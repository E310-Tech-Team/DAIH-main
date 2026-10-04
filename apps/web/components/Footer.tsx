import React from "react";
import Link from "next/link";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "../lib/config";

export const Footer = () => {
  return (
    <>
      <a href="#" id="back-to-top"></a>
      <footer className="footer-light">
        <div className="container">
          <div className="row">
            <div className="col-md-3 col-sm-6 col-xs-1">
              <div className="widget">
                <h5>Plans</h5>
                <ul>
                  <li>
                    <Link href="/dedicated-desk">Dedicated Desk</Link>
                  </li>
                  <li>
                    <Link href="/hot-desk">Hot Desk</Link>
                  </li>
                  <li>
                    <Link href="/office-suite">Office Suite</Link>
                  </li>
                  <li>
                    <Link href="/conference-hall">Conference Hall</Link>
                  </li>
                  <li>
                    <Link href="/training-room">Training Room</Link>
                  </li>
                  <li>
                    <a href="#">Lounge (Coming Soon)</a>
                  </li>
                  <li>
                    <a href="#">Studio (Coming Soon)</a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="col-md-3 col-sm-6 col-xs-1">
              <div className="widget">
                <h5>Company</h5>
                <ul>
                  <li>
                    <Link href="/about-us">About Us</Link>
                  </li>
                  <li>
                    <Link href="/news">News</Link>
                  </li>
                  <li>
                    <Link href="/jobs">Jobs</Link>
                  </li>
                  <li>
                    <Link href="/contact">Contact</Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="col-md-3 col-sm-6 col-xs-1">
              <div className="widget">
                <h5>Events</h5>
                <ul>
                  <li>
                    <Link href="/events">Upcoming Innovation Events</Link>
                  </li>
                  <li>
                    <Link href="/events">Hackathons & Bootcamps</Link>
                  </li>
                  <li>
                    <Link href="/events">Founders Fireside</Link>
                  </li>
                  <li>
                    <Link href="/events">Tech Community Meetups</Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="col-md-3 col-sm-6 col-xs-1">
              <div className="widget">
                <h5>Newsletter</h5>
                <p>
                  Sign up for our newsletter to get the latest news in your
                  inbox.
                </p>
                <form
                  action="#"
                  className="row form-dark"
                  id="form_subscribe"
                  method="post"
                  name="form_subscribe"
                >
                  <div className="col text-center">
                    <input
                      className="form-control"
                      id="txt_subscribe"
                      name="txt_subscribe"
                      placeholder="Enter your email"
                      type="text"
                    />
                    <a href="#" id="btn-subscribe">
                      <i className="arrow_right bg-color-secondary"></i>
                    </a>
                    <div className="clearfix"></div>
                  </div>
                </form>
                <div className="spacer-10"></div>
                <small>Your email is safe with us. We don't spam.</small>
              </div>
            </div>
          </div>
        </div>

        <div className="subfooter">
          <div className="container">
            <div className="row">
              <div className="col-md-12">
                <div className="de-flex">
                  <div className="de-flex-col">
                    <Link href="/">
                      <img
                        alt="DAIH logo"
                        className="f-logo"
                        src="/images/logo-light.png"
                      />
                      <span className="copy">
                        &copy; Copyright 2026 - The Dare Adeboye Innovation Hub
                      </span>
                    </Link>
                    {/* Required on the home page for Google OAuth brand verification.
                        Link straight to the portal URLs entered in Google's Branding page. */}
                    <span className="copy">
                      {" · "}
                      <a href={PRIVACY_POLICY_URL}>Privacy Policy</a>
                      {" · "}
                      <a href={TERMS_OF_SERVICE_URL}>Terms of Service</a>
                    </span>
                  </div>
                  <div className="de-flex-col">
                    <div className="social-icons">
                      <a
                        href="https://www.facebook.com/thedaihofficial"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="fa fa-facebook fa-lg"></i>
                      </a>
                      <a
                        href="https://www.twitter.com/thedaihofficial"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="fa fa-twitter fa-lg"></i>
                      </a>
                      <a
                        href="https://www.linkedin.com/company/thedaihofficial"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="fa fa-linkedin fa-lg"></i>
                      </a>
                      <a
                        href="https://www.instagram.com/thedaihofficial"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="fa fa-instagram fa-lg"></i>
                      </a>
                      <a
                        href="https://www.youtube.com/@thedaihofficial"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="fa fa-youtube-play fa-lg"></i>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};
