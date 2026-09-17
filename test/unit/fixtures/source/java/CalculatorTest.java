package com.example.calculator;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CalculatorTest {

    private final Calculator calculator = new Calculator();

    /**
     * Javadoc mentioning @Test on purpose — it must not become a declaration.
     */
    private int helper(int value) {
        return value * 2;
    }

    @Test
    void addReturnsSum() {
        assertEquals(5, calculator.add(2, 3));
    }

    @ParameterizedTest
    @CsvSource({
        "10, 2, 5",
        "9, 3, 3"
    })
    void divideReturnsQuotient(int a, int b, int expected) {
        assertEquals(expected, calculator.divide(a, b));
    }

    @Disabled("parked")
    @Test
    void parkedTest() {
        assertEquals(1, calculator.add(0, 1));
    }

    @Test
    @DisplayName("adds two and three")
    void displayNamed() {
        assertEquals(5, calculator.add(2, 3));
    }

    @Test
    void braceInsideAString() {
        assertEquals("{", calculator.format("{"));
    }

    @Test
    void emptyBody() {
    }

    @Test
    <T extends Number> void genericSignature() {
        assertTrue(calculator.add(1, 1) > 0);
    }

    @Test
    void throwsOnDivideByZero() throws Exception {
        assertThrows(ArithmeticException.class, () -> calculator.divide(1, 0));
    }

    @Nested
    class InnerCases {
        @Test
        void ambiguous() {
            assertEquals(2, calculator.add(1, 1));
        }
    }

    @Nested
    class OtherCases {
        @Test
        void ambiguous() {
            assertEquals(3, calculator.add(1, 2));
        }
    }
}
