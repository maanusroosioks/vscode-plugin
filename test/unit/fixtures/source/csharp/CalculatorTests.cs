using System;
using Xunit;

namespace CalculatorSample.Tests
{
    public class CalculatorTests
    {
        private readonly int[] samples = new[] { 1, 2, 3 };

        private int Helper(int value) => value * 2;

        [Fact]
        public void Add_ReturnsSum()
        {
            var calculator = new Calculator();
            Assert.Equal(5, calculator.Add(2, 3));
        }

        [Theory]
        [InlineData(10, 2, 5)]
        [InlineData(9, 3, 3)]
        public void Divide_ReturnsQuotient(int a, int b, int expected)
        {
            var calculator = new Calculator();
            Assert.Equal(expected, calculator.Divide(a, b));
        }

        [Fact]
        public void Divide_ByZero_Throws()
        {
            var calculator = new Calculator();
            Assert.Throws<DivideByZeroException>(() => calculator.Divide(1, 0));
        }

        [Fact(Skip = "not implemented yet")]
        public void Parked()
        {
            Assert.True(false);
        }

        [Fact(DisplayName = "adds two and three")]
        public void DisplayNamed()
        {
            Assert.Equal(5, new Calculator().Add(2, 3));
        }

        [Fact]
        public void ExpressionBodied() => Assert.Equal(2, new Calculator().Add(1, 1));

        [Fact]
        public void BraceInsideAString()
        {
            var verbatim = @"a } "" b";
            Assert.Contains("}", verbatim);
        }

        [Fact]
        public void EmptyBody()
        {
        }
    }
}
