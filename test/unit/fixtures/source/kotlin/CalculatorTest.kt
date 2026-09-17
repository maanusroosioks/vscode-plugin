package com.example.calculator

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CalculatorTest {

    private val calculator = Calculator()

    @Test
    fun `adds two and three`() {
        assertEquals(5, calculator.add(2, 3))
    }

    @Test
    fun expressionBodied() = assertTrue(calculator.add(1, 1) == 2)

    @Test
    fun rawStringWithBrace() {
        val template = """
            { "not": "code" }
        """
        assertTrue(template.contains("not"))
    }

    @Test
    fun emptyBody() {
    }
}
