import { useRef, useEffect, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";

export default function DatePickerInput({ 
  value, 
  onChange, 
  minDate = null,
  placeholder = "Select a date",
  disabled = false,
  label = null 
}) {
  const [showCalendar, setShowCalendar] = useState(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  // Convert date string (YYYY-MM-DD) to Date object
  const parseDate = (dateString) => {
    if (!dateString) return new Date();
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  // Convert Date object to date string (YYYY-MM-DD)
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const selectedDate = parseDate(value);
  const minDateObj = minDate ? parseDate(minDate) : new Date();

  // Close calendar on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowCalendar(false);
      }
    };

    if (showCalendar) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showCalendar]);

  const handleDateChange = (date) => {
    const formattedDate = formatDate(date);
    onChange(formattedDate);
    setShowCalendar(false);
  };

  const handleInputClick = () => {
    if (!disabled) {
      setShowCalendar(!showCalendar);
    }
  };

  return (
    <div className="date-picker-wrapper" ref={wrapperRef}>
      {label && <label>{label}</label>}
      <div className="date-picker-input-container">
        <input
          ref={inputRef}
          type="text"
          value={value || ""}
          placeholder={placeholder}
          onClick={handleInputClick}
          readOnly
          disabled={disabled}
          className="date-picker-input"
        />
        <span className="date-picker-icon" onClick={handleInputClick}>
          📅
        </span>
      </div>
      {showCalendar && (
        <div className="date-picker-calendar">
          <Calendar
            onChange={handleDateChange}
            value={selectedDate}
            minDate={minDateObj}
            tileDisabled={({ date }) => date < minDateObj}
          />
        </div>
      )}
    </div>
  );
}
